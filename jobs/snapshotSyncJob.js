// jobs/snapshotSyncJob.js — 快照同步定时任务
// 将内部库已完结订单/账单的摘要推送到外部库（publicDb），供客户查询门户使用。
//
// 同步策略：
//   1. 遍历 public_clients 获取所有有效客户 token 的 (baseId, customerKey) 映射
//   2. 对每个 base，查找已完结订单中关联到该客户的记录
//   3. 将订单摘要写入 public_customer_snapshot
//
// 也可在关键业务节点（订单完结、账单生成）后主动调用 syncSingleOrder。

const { tableByName, fieldsMap, cellValue, cellValueByName, numValue, firstLinkedRecordId, displayValue } = require('../services/helpers');
const dbAdapter = require('../services/dbAdapter');
const { upsertSnapshot } = require('../publicDb');

/**
 * 同步单个订单的快照到外部库
 * @param {string} baseId
 * @param {string} orderRecordId - 内部订单记录 ID
 * @param {string} customerKey - 外部客户标识
 * @returns {Promise<{ ok: boolean, category: string, refId: string }>}
 */
async function syncSingleOrder(baseId, orderRecordId, customerKey) {
  if (!baseId || !orderRecordId || !customerKey) return { ok: false, error: 'missing params' };

  const orderTable = await tableByName(baseId, '订单管理区');
  if (!orderTable) return { ok: false, error: 'order table not found' };

  const of = await fieldsMap(orderTable.id);
  // 采集物流信息
  const trackingNo = await cellValue(orderRecordId, of['物流单号']?.id);
  const trackingNote = await cellValue(orderRecordId, of['物流备注']?.id);
  const trackingUpdatedAt = await cellValue(orderRecordId, of['物流更新日期']?.id);

  // 采集产品详细信息
  const productId = await firstLinkedRecordId(orderRecordId, of['产品']?.id);
  let productDetail = {};
  if (productId) {
    const productTable = await tableByName(baseId, '产品目录');
    if (productTable) {
      const pf = await fieldsMap(productTable.id);
      productDetail = {
        productId: await displayValue(productId, ['产品ID', '货号']),
        productSpec: await cellValue(productId, pf['规格']?.id),
        productRegion: await cellValue(productId, pf['地区']?.id),
        productPrice: await numValue(productId, pf['销售单价']?.id),
        productStatus: await cellValue(productId, pf['产品状态']?.id),
        isSpecialOffer: await cellValue(productId, pf['特价标记']?.id) === 'true' || await cellValue(productId, pf['特价标记']?.id) === '是',
      };
    }
  }

  const data = {
    orderNo: await displayValue(orderRecordId, ['内部订单号', '订单号']),
    status: await cellValue(orderRecordId, of['订单状态']?.id),
    receivable: await numValue(orderRecordId, of['应收金额']?.id),
    payable: await numValue(orderRecordId, of['应付金额']?.id),
    productName: await displayValue(productId, ['标题', '产品ID', '名称']),
    payerName: await displayValue(await firstLinkedRecordId(orderRecordId, of['付款方']?.id), ['企业名称', '代码', '名称']),
    payeeName: await displayValue(await firstLinkedRecordId(orderRecordId, of['收款方']?.id), ['企业名称', '代码', '名称']),
    completedDate: await cellValue(orderRecordId, of['完结日期']?.id) || await cellValue(orderRecordId, of['财务付款时间']?.id),
    snapshotProfit: await cellValue(orderRecordId, of['快照毛利']?.id),
    snapshotReceived: await cellValue(orderRecordId, of['快照实收']?.id),
    snapshotPaid: await cellValue(orderRecordId, of['快照实付']?.id),
    // 物流信息
    trackingNo: trackingNo || null,
    trackingNote: trackingNote || null,
    trackingUpdatedAt: trackingUpdatedAt || null,
    // 产品详情
    ...productDetail,
  };

  await upsertSnapshot({
    baseId,
    customerKey,
    category: 'order',
    refId: orderRecordId,
    data,
  });

  return { ok: true, category: 'order', refId: orderRecordId };
}

/**
 * 全量同步：遍历所有 base 的已完结订单，推送到外部库
 * @param {object} opts
 * @param {Function} [opts.logger] - 日志回调
 * @returns {Promise<{ synced: number, skipped: number, errors: number }>}
 */
async function syncAllSnapshots(opts = {}) {
  const { logger } = opts;
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  // 1. 获取所有有效客户映射（public_clients 在 public.db 中）
  const publicDb = require('../publicDb').publicDb;
  const clients = publicDb.prepare(
    "SELECT base_id, customer_key FROM public_clients WHERE revoked=0 AND (expires_at IS NULL OR expires_at > ?)"
  ).all(Date.now());

  if (!clients.length) {
    if (logger) logger({ status: 'info', message: 'No active client tokens, skipping snapshot sync' });
    return { synced: 0, skipped: 0, errors: 0 };
  }

  // 按 baseId 分组
  const byBase = new Map();
  for (const c of clients) {
    const arr = byBase.get(c.base_id) || [];
    arr.push(c.customer_key);
    byBase.set(c.base_id, arr);
  }

  // 2. 对每个 base 查找已完结订单
  for (const [baseId, customerKeys] of byBase) {
    const orderTable = await tableByName(baseId, '订单管理区');
    if (!orderTable) { skipped++; continue; }

    const of = await fieldsMap(orderTable.id);
    const statusFieldId = of['订单状态']?.id;
    if (!statusFieldId) { skipped++; continue; }

    // 查找已完结状态的订单记录 ID
    const completedOrders = await dbAdapter.queryAsync(
      "SELECT record_id FROM cells WHERE field_id=$1 AND value IN ('已完结', '已完成') ORDER BY updated_at DESC",
      [statusFieldId]
    );

    for (const row of completedOrders) {
      const orderId = row.record_id;
      // 查找该订单关联的客户账户
      const customerLinkFieldId = of['客户']?.id || of['客户账户']?.id;
      let matchedKey = null;

      if (customerLinkFieldId) {
        const customerId = await firstLinkedRecordId(orderId, customerLinkFieldId);
        if (customerId) {
          // 用客户名称匹配 customerKey（因为 customerKey 是管理员设定的标识）
          const customerName = await displayValue(customerId, ['客户名称', '名称', '企业名称']);
          if (customerName && customerKeys.includes(customerName)) {
            matchedKey = customerName;
          }
        }
      }

      // 如果没有精确匹配，尝试用所有 customerKey 都推送一份（兜底策略）
      if (!matchedKey) {
        // 只对明确关联了客户的订单推送
        skipped++;
        continue;
      }

      try {
        await syncSingleOrder(baseId, orderId, matchedKey);
        synced++;
      } catch (e) {
        errors++;
        if (logger) logger({ status: 'error', baseId, orderId, error: e.message });
      }
    }
  }

  if (logger) logger({ status: 'done', synced, skipped, errors });
  return { synced, skipped, errors };
}

/**
 * 同步产品目录到外部库（特价商品、今日报价、断货求购）
 * @param {string} baseId
 * @param {string} customerKey
 * @returns {Promise<{ synced: number, errors: number }>}
 */
async function syncProductCatalog(baseId, customerKey) {
  if (!baseId || !customerKey) return { synced: 0, errors: 0 };
  const productTable = await tableByName(baseId, '产品目录');
  if (!productTable) return { synced: 0, errors: 0 };

  const pf = await fieldsMap(productTable.id);
  const products = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1', [productTable.id]);
  let synced = 0;
  let errors = 0;

  for (const product of products) {
    try {
      const data = {
        productId: await displayValue(product.id, ['产品ID', '货号']),
        name: await cellValue(product.id, pf['名称']?.id),
        title: await displayValue(product.id, ['标题']),
        spec: await cellValue(product.id, pf['规格']?.id),
        region: await cellValue(product.id, pf['地区']?.id),
        price: await numValue(product.id, pf['销售单价']?.id),
        status: await cellValue(product.id, pf['产品状态']?.id),
        isSpecialOffer: await cellValue(product.id, pf['特价标记']?.id) === 'true' || await cellValue(product.id, pf['特价标记']?.id) === '是',
        stockQty: await numValue(product.id, pf['当前实际库存']?.id),
        virtualStock: await numValue(product.id, pf['当前虚拟库存']?.id),
        availableQty: await numValue(product.id, pf['可用库存']?.id),
        updatedAt: product.updated_at,
      };

      await upsertSnapshot({
        baseId,
        customerKey,
        category: 'product',
        refId: product.id,
        data,
      });
      synced++;
    } catch (e) {
      errors++;
    }
  }

  return { synced, errors };
}

/**
 * 同步库存预警/断货求购信息
 * @param {string} baseId
 * @param {string} customerKey
 * @returns {Promise<{ outOfStock: number, lowStock: number }>}
 */
async function syncStockAlerts(baseId, customerKey) {
  if (!baseId || !customerKey) return { outOfStock: 0, lowStock: 0 };
  const productTable = await tableByName(baseId, '产品目录');
  if (!productTable) return { outOfStock: 0, lowStock: 0 };

  const pf = await fieldsMap(productTable.id);
  const products = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1', [productTable.id]);
  let outOfStock = 0;
  let lowStock = 0;

  for (const product of products) {
    const available = await numValue(product.id, pf['可用库存']?.id) || 0;
    const minStock = await numValue(product.id, pf['安全库存']?.id) || 0;

    if (available <= 0) {
      outOfStock++;
      await upsertSnapshot({
        baseId,
        customerKey,
        category: 'stock_alert',
        refId: product.id,
        data: {
          type: 'out_of_stock',
          productId: await displayValue(product.id, ['产品ID', '货号']),
          productName: await cellValue(product.id, pf['名称']?.id),
          availableQty: 0,
          alertDate: new Date().toISOString().split('T')[0],
        },
      });
    } else if (minStock > 0 && available < minStock) {
      lowStock++;
      await upsertSnapshot({
        baseId,
        customerKey,
        category: 'stock_alert',
        refId: product.id,
        data: {
          type: 'low_stock',
          productId: await displayValue(product.id, ['产品ID', '货号']),
          productName: await cellValue(product.id, pf['名称']?.id),
          availableQty: available,
          minStock,
          alertDate: new Date().toISOString().split('T')[0],
        },
      });
    }
  }

  return { outOfStock, lowStock };
}

module.exports = {
  syncSingleOrder,
  syncAllSnapshots,
  syncProductCatalog,
  syncStockAlerts,
};

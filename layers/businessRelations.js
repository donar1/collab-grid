// 第二层：五个核心业务对象与调用链路
// 这一层只描述产品、客户、订单、账单、库存之间的业务关系，不承载大屏展示或财务核算优化。

const CORE_BUSINESS_OBJECTS = Object.freeze({
  product: {
    name: '产品',
    primaryTables: ['产品名称数据源区', '产品信息区'],
    owns: ['售价', '成本', '货号', '产品快照'],
    calledBy: ['订单', '库存'],
  },
  customer: {
    name: '客户',
    primaryTables: ['资源档案中心', '财务结算对象区'],
    owns: ['企业名称', '合作渠道', '结算对象'],
    calledBy: ['订单', '账单', '业务锁定'],
  },
  order: {
    name: '订单',
    primaryTables: ['订单管理区', '退款处理区', '撤单处理区'],
    owns: ['订单状态', '付款方', '收款方', '产品', '应收金额', '应付金额'],
    calls: ['产品', '客户'],
    calledBy: ['库存', '账单', '佣金作业', '数据大屏'],
  },
  bill: {
    name: '账单',
    primaryTables: ['应收结算明细区', '应付结算明细区', '收付款流水区', '财务红冲处理区'],
    owns: ['应收金额', '应付金额', '红冲金额', '明细状态', '结算对象'],
    calls: ['订单', '客户'],
    calledBy: ['财务核算', '数据大屏'],
  },
  inventory: {
    name: '库存',
    primaryTables: ['库存商品区', '出入库操作区', '库存流水区'],
    owns: ['当前实际库存', '当前虚拟库存', '所属仓储', '当前成本'],
    calls: ['产品', '订单'],
    calledBy: ['数据大屏'],
  },
});

const BUSINESS_CALL_CHAIN = Object.freeze([
  {
    from: '产品',
    to: '订单',
    relation: '订单选择产品并快照售价、成本、产品名称',
    direction: 'product -> order',
  },
  {
    from: '客户',
    to: '订单',
    relation: '订单通过付款方/收款方关联客户或渠道资源',
    direction: 'customer -> order',
  },
  {
    from: '订单',
    to: '账单',
    relation: '完结订单生成应收/应付结算明细；撤单/退款只标记是否需要红冲',
    direction: 'order -> bill',
  },
  {
    from: '订单',
    to: '库存',
    relation: '自营付款方出库扣减实际库存；非自营出库不扣库存',
    direction: 'order -> inventory',
  },
  {
    from: '库存',
    to: '产品',
    relation: '实际/虚拟入库审核后更新库存成本，并同步产品成本',
    direction: 'inventory -> product',
  },
  {
    from: '账单',
    to: '财务核算',
    relation: '账单明细作为核算输入；封账后只能通过红冲形成反向明细',
    direction: 'bill -> finance',
  },
  {
    from: '订单/账单/库存',
    to: '数据大屏',
    relation: '大屏只读取核心层结果，不反向写入核心业务数据',
    direction: 'core -> dashboard',
  },
]);

function relationSummary() {
  return BUSINESS_CALL_CHAIN.map(item => `${item.from} -> ${item.to}: ${item.relation}`);
}

module.exports = {
  CORE_BUSINESS_OBJECTS,
  BUSINESS_CALL_CHAIN,
  relationSummary,
};

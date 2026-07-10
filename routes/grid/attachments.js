// routes/grid/attachments.js — 附件/图片上传下载路由
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'attachments');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 允许的文件类型
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.ms-excel',  // xls
  'application/msword',  // doc
  'text/csv', 'text/plain',
  'application/zip', 'application/x-rar-compressed',
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 上传附件（异步版本 - 仅处理数据库操作，文件写入由调用方处理）
 * @param {object} fileMeta - { baseId, recordId, fieldId, fileName, mimeType, fileSize, safeName }
 * @param {string} userId
 * @returns {object} { id, fileName, mimeType, size }
 */
async function saveAttachmentAsync(fileMeta, userId) {
  const { baseId, recordId, fieldId, fileName, mimeType, fileSize, safeName } = fileMeta;
  const id = nanoid();
  const ts = Date.now();

  await dbAdapter.writeQueryAsync(
    'INSERT INTO attachments (id, base_id, record_id, field_id, file_name, file_type, file_size, file_path, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id, baseId, recordId, fieldId, fileName, mimeType, fileSize, safeName, userId, ts]
  );

  // 更新 cell 值为 JSON 数组（存储附件 ID 列表）
  const existing = await dbAdapter.queryOneAsync(
    'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
    [recordId, fieldId]
  );
  let ids = [];
  try { ids = existing?.value ? JSON.parse(existing.value) : []; } catch { ids = []; }
  if (!Array.isArray(ids)) ids = [];
  ids.push(id);

  await dbAdapter.writeQueryAsync(`
    INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `, [recordId, fieldId, JSON.stringify(ids), ts, userId]);

  return { id, fileName, mimeType, size: fileSize };
}

/**
 * 获取附件信息（异步版本）
 * @param {string} attachmentId
 * @returns {object|null} 附件记录
 */
async function getAttachmentAsync(attachmentId) {
  return dbAdapter.queryOneAsync('SELECT * FROM attachments WHERE id=$1', [attachmentId]);
}

/**
 * 获取记录的附件列表（异步版本）
 * @param {string} recordId
 * @param {string} fieldId
 * @returns {Array} 附件列表
 */
async function listAttachmentsAsync(recordId, fieldId) {
  return dbAdapter.queryAsync(
    'SELECT id, file_name, file_type, file_size, created_at FROM attachments WHERE record_id=$1 AND field_id=$2 ORDER BY created_at',
    [recordId, fieldId]
  );
}

/**
 * 删除附件（异步版本 - 仅处理数据库操作，文件删除由调用方处理）
 * @param {string} attachmentId
 * @param {string} userId
 * @returns {object} { attachmentId, fileName }
 */
async function deleteAttachmentAsync(attachmentId, userId) {
  const att = await dbAdapter.queryOneAsync('SELECT * FROM attachments WHERE id=$1', [attachmentId]);
  if (!att) throw new Error('attachment not found');

  // 从 cell 的 JSON 数组中移除
  const existing = await dbAdapter.queryOneAsync(
    'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
    [att.record_id, att.field_id]
  );
  try {
    let ids = existing?.value ? JSON.parse(existing.value) : [];
    if (Array.isArray(ids)) {
      ids = ids.filter(id => id !== att.id);
      const ts = Date.now();
      await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [att.record_id, att.field_id, JSON.stringify(ids), ts, userId]);
    }
  } catch { /* noop */ }

  await dbAdapter.writeQueryAsync('DELETE FROM attachments WHERE id=$1', [att.id]);

  return { attachmentId: att.id, fileName: att.file_name, baseId: att.base_id };
}

/**
 * 解析 multipart/form-data（无外部依赖）
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{fields: Object, files: Array<{fieldname, filename, mime, data: Buffer}>>}>}
 */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.match(/boundary=(.+)/)?.[1];
    if (!boundary) return reject(new Error('missing boundary'));

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total
        if (buf.length > MAX_TOTAL_SIZE) {
          return reject(new Error(`total upload size ${Math.round(buf.length/1024/1024)}MB exceeds limit 100MB`));
        }
        const sep = Buffer.from(`--${boundary}`);
        const parts = [];
        let start = buf.indexOf(sep) + sep.length;
        while (true) {
          const next = buf.indexOf(sep, start);
          if (next === -1) break;
          parts.push(buf.slice(start, next));
          start = next + sep.length;
        }

        const MAX_PARTS = 50;
        if (parts.length > MAX_PARTS) {
          return reject(new Error(`too many parts: ${parts.length} (max ${MAX_PARTS})`));
        }

        const fields = {};
        const files = [];

        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const header = part.slice(0, headerEnd).toString();
          const body = part.slice(headerEnd + 4);

          // 去掉末尾的 \r\n
          const content = body.length >= 2 && body[body.length - 2] === 13 ? body.slice(0, -2) : body;

          const nameMatch = header.match(/name="([^"]+)"/);
          const filenameMatch = header.match(/filename="([^"]+)"/);
          const mimeMatch = header.match(/Content-Type:\s*(.+)/);

          if (!nameMatch) continue;
          const fieldname = nameMatch[1];

          if (filenameMatch) {
            files.push({
              fieldname,
              filename: filenameMatch[1],
              mime: (mimeMatch?.[1] || 'application/octet-stream').trim(),
              data: content,
            });
          } else {
            fields[fieldname] = content.toString();
          }
        }

        resolve({ fields, files });
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function (ctx) {
  const { authRequired, canManageStructure, broadcast, audit } = ctx;
  const express = require('express');
  const router = express.Router();

  // 上传附件
  router.post('/api/attachments/upload', authRequired, asyncHandler(async (req, res) => {
    try {
      const { fields, files } = await parseMultipart(req);
      const baseId = fields.baseId;
      const recordId = fields.recordId;
      const fieldId = fields.fieldId;

      if (!baseId || !recordId || !fieldId) {
        return res.status(400).json({ error: 'baseId, recordId, fieldId required' });
      }

      // 验证字段类型是 attachment
      const field = await dbAdapter.queryOneAsync('SELECT type, table_id FROM fields WHERE id=$1', [fieldId]);
      if (!field || field.type !== 'attachment') {
        return res.status(400).json({ error: 'field is not attachment type' });
      }

      // 验证表属于该 base
      const table = await dbAdapter.queryOneAsync('SELECT base_id FROM tables WHERE id=$1', [field.table_id]);
      if (!table || table.base_id !== baseId) {
        return res.status(403).json({ error: 'field does not belong to this base' });
      }

      const results = [];
      for (const file of files) {
        if (file.data.length > MAX_FILE_SIZE) {
          results.push({ filename: file.filename, error: 'file too large (max 20MB)' });
          continue;
        }
        if (!ALLOWED_MIME.has(file.mime)) {
          results.push({ filename: file.filename, error: 'unsupported file type' });
          continue;
        }

        const id = nanoid();
        const ext = path.extname(file.filename) || '.bin';
        const safeName = `${id}${ext}`;
        const filePath = path.join(UPLOAD_DIR, safeName);

        await fsp.writeFile(filePath, file.data);

        const ts = Date.now();
        await dbAdapter.writeQueryAsync(
          'INSERT INTO attachments (id, base_id, record_id, field_id, file_name, file_type, file_size, file_path, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [id, baseId, recordId, fieldId, file.filename, file.mime, file.data.length, safeName, req.user.id, ts]
        );

        // 更新 cell 值为 JSON 数组（存储附件 ID 列表）
        const existing = await dbAdapter.queryOneAsync(
          'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
          [recordId, fieldId]
        );
        let ids = [];
        try { ids = existing?.value ? JSON.parse(existing.value) : []; } catch { ids = []; }
        if (!Array.isArray(ids)) ids = [];
        ids.push(id);
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
        `, [recordId, fieldId, JSON.stringify(ids), ts, req.user.id]);

        results.push({ id, filename: file.filename, mimeType: file.mime, size: file.data.length });
      }

      broadcast(baseId, 'record:update', { recordId, updatedAt: Date.now() });
      res.json({ ok: true, files: results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  // 下载附件
  router.get('/api/attachments/:id/download', authRequired, asyncHandler(async (req, res) => {
    const att = await dbAdapter.queryOneAsync('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'attachment not found' });

    // IDOR 防护：验证用户是该附件所属 Base 的成员
    if (!(await ctx.isMember(att.base_id, req.user.id))) {
      return res.status(403).json({ error: 'no permission to access this attachment' });
    }

    const filePath = path.join(UPLOAD_DIR, att.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found on disk' });

    res.setHeader('Content-Type', att.file_type);
    // SVG 文件强制下载，防止 XSS
    if (att.file_type === 'image/svg+xml') {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.file_name)}"`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.file_name)}"`);
    }
    res.setHeader('Content-Length', att.file_size);
    fs.createReadStream(filePath).pipe(res);
  }));

  // 删除附件
  router.delete('/api/attachments/:id', authRequired, asyncHandler(async (req, res) => {
    const att = await dbAdapter.queryOneAsync('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
    if (!att) return res.status(404).json({ error: 'attachment not found' });

    // IDOR 防护：验证用户是该附件所属 Base 的成员
    if (!(await ctx.isMember(att.base_id, req.user.id))) {
      return res.status(403).json({ error: 'no permission to delete this attachment' });
    }

    // 从 cell 的 JSON 数组中移除
    const existing = await dbAdapter.queryOneAsync(
      'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
      [att.record_id, att.field_id]
    );
    try {
      let ids = existing?.value ? JSON.parse(existing.value) : [];
      if (Array.isArray(ids)) {
        ids = ids.filter(id => id !== att.id);
        const ts = Date.now();
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
        `, [att.record_id, att.field_id, JSON.stringify(ids), ts, req.user.id]);
      }
    } catch { /* noop */ }

    // 删除文件
    const filePath = path.join(UPLOAD_DIR, att.file_path);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* noop */ }

    await dbAdapter.writeQueryAsync('DELETE FROM attachments WHERE id=$1', [att.id]);
    await audit(att.base_id, req.user.id, 'attachment.delete', { attachmentId: att.id, filename: att.file_name });
    res.json({ ok: true });
  }));

  // 获取记录的附件列表
  router.get('/api/attachments', authRequired, asyncHandler(async (req, res) => {
    const { recordId, fieldId } = req.query;
    if (!recordId || !fieldId) return res.status(400).json({ error: 'recordId and fieldId required' });

    // Base 成员检查：通过附件的 base_id 验证用户是否为该 base 的成员
    const sampleAtt = await dbAdapter.queryOneAsync(
      'SELECT base_id FROM attachments WHERE record_id=$1 AND field_id=$2 LIMIT 1',
      [recordId, fieldId]
    );
    if (sampleAtt && !(await ctx.isMember(sampleAtt.base_id, req.user.id))) {
      return res.status(403).json({ error: 'no permission to access attachments of this record' });
    }

    const atts = await dbAdapter.queryAsync(
      'SELECT id, file_name, file_type, file_size, created_at FROM attachments WHERE record_id=$1 AND field_id=$2 ORDER BY created_at',
      [recordId, fieldId]
    );
    res.json({ attachments: atts });
  }));

  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.saveAttachmentAsync = saveAttachmentAsync;
module.exports.getAttachmentAsync = getAttachmentAsync;
module.exports.listAttachmentsAsync = listAttachmentsAsync;
module.exports.deleteAttachmentAsync = deleteAttachmentAsync;

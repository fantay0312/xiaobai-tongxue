import crypto from 'node:crypto';
import path from 'node:path';
import {
  hasBlockingIssues,
  normalizeTopicDraft,
  studentTopicView,
  teacherEditableDraft,
  validateTopicDraft,
} from './topic-contract.mjs';
import { TOPIC_PROMPT_VERSION } from './topic-compiler.mjs';

const COURSE_TITLE_MAX = 120;
const TOPIC_TITLE_MAX = 160;
const DEFAULT_MAX_FILE_BYTES = 80 * 1024 * 1024;
const ASSET_ROLES = new Set(['lecture', 'lab', 'syllabus', 'reading']);
const PARSE_STATUSES = new Set([
  'pending', 'processing', 'finalizing', 'completed', 'failed', 'deleting', 'cancelled',
]);

const FILE_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
});

function publicError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function cleanText(value, maximum) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

function cleanMultiline(value, maximum) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maximum)
    : '';
}

function cleanFilename(value) {
  const normalized = String(value ?? '').normalize('NFKC').replaceAll('\\', '/').replace(/[\u0000-\u001f\u007f]/g, '');
  if (!normalized || normalized.startsWith('/') || normalized.length > 260) throw publicError('filename-invalid');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) throw publicError('filename-invalid');
  return parts.join('/');
}

function isZip(bytes) {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
}

function zipDirectory(bytes) {
  const minimumEocd = 22;
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - minimumEocd; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + minimumEocd > bytes.length) throw publicError('file-content-mismatch', 415);
  const disk = bytes.readUInt16LE(eocd + 4);
  const directoryDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount
    || entryCount < 1 || entryCount > 5_000
    || directoryOffset + directorySize > eocd
    || eocd + minimumEocd + commentLength !== bytes.length) {
    throw publicError('file-content-mismatch', 415);
  }
  const entries = [];
  const names = new Set();
  let offset = directoryOffset;
  let expandedBytes = 0;
  let compressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw publicError('file-content-mismatch', 415);
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const entryDisk = bytes.readUInt16LE(offset + 34);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + entryCommentLength;
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || entryDisk !== 0
      || compressedSize === 0xffffffff || expandedSize === 0xffffffff
      || nameLength < 1 || nameLength > 512 || next > eocd
      || localOffset + 30 > directoryOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw publicError('file-content-mismatch', 415);
    }
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const normalizedName = name.replaceAll('\\', '/');
    if (!normalizedName || normalizedName.startsWith('/') || /^[a-z]:/i.test(normalizedName)
      || normalizedName.split('/').some((part) => part === '..') || names.has(normalizedName)) {
      throw publicError('file-content-mismatch', 415);
    }
    names.add(normalizedName);
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .toString('utf8').replaceAll('\\', '/');
    if (localFlags !== flags || localMethod !== method || localName !== normalizedName
      || dataOffset + compressedSize > directoryOffset) throw publicError('file-content-mismatch', 415);
    expandedBytes += expandedSize;
    compressedBytes += compressedSize;
    if (expandedSize > 128 * 1024 * 1024 || expandedBytes > 256 * 1024 * 1024) {
      throw publicError('file-archive-too-large', 413);
    }
    entries.push({ name: normalizedName, expandedSize });
    offset = next;
  }
  if (offset !== directoryOffset + directorySize
    || expandedBytes > Math.max(1, compressedBytes) * 200) {
    throw publicError('file-archive-too-large', 413);
  }
  return entries;
}

function validOoxml(bytes, extension) {
  if (!isZip(bytes)) return false;
  const entries = zipDirectory(bytes);
  const required = extension === '.docx'
    ? ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
    : ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml'];
  return required.every((name) => entries.some((entry) => entry.name === name && entry.expandedSize > 0));
}

function isOle(bytes) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function cfbChain(fat, start, sectorCount, maximum) {
  const FREE = 0xffffffff;
  const END = 0xfffffffe;
  const FAT = 0xfffffffd;
  const DIFAT = 0xfffffffc;
  const chain = [];
  const seen = new Set();
  let sector = start;
  while (sector !== END) {
    if (sector === FREE || sector === FAT || sector === DIFAT
      || sector >= sectorCount || seen.has(sector) || chain.length >= maximum) {
      throw publicError('file-content-mismatch', 415);
    }
    seen.add(sector);
    chain.push(sector);
    sector = fat[sector];
    if (sector === undefined) throw publicError('file-content-mismatch', 415);
  }
  return chain;
}

function cfbStream(bytes, chain, offsetOf, unitSize, size, readSize = size) {
  return cfbStreamSlice(bytes, chain, offsetOf, unitSize, size, 0, Math.min(size, readSize));
}

function cfbStreamSlice(bytes, chain, offsetOf, unitSize, size, start, length) {
  if (size < 1 || start < 0 || length < 1 || start + length > size
    || chain.length * unitSize < size) return null;
  const requested = length;
  const result = Buffer.allocUnsafe(requested);
  let written = 0;
  let logicalOffset = start;
  while (written < requested) {
    const chainIndex = Math.floor(logicalOffset / unitSize);
    const withinSector = logicalOffset % unitSize;
    const sector = chain[chainIndex];
    const offset = offsetOf(sector) + withinSector;
    const copyLength = Math.min(unitSize - withinSector, requested - written);
    if (sector === undefined || offset < 0 || offset + copyLength > bytes.length) return null;
    bytes.copy(result, written, offset, offset + copyLength);
    written += copyLength;
    logicalOffset += copyLength;
  }
  return written === requested ? result : null;
}

function pptRecordHeader(bytes, streamSize, offset) {
  if (!bytes || bytes.length < 8 || offset < 0 || offset + 8 > streamSize) return null;
  const versionAndInstance = bytes.readUInt16LE(0);
  const length = bytes.readUInt32LE(4);
  if (offset + 8 + length > streamSize) return null;
  return {
    version: versionAndInstance & 0x000f,
    instance: versionAndInstance >>> 4,
    type: bytes.readUInt16LE(2),
    length,
  };
}

function validLegacyPowerPoint(bytes) {
  if (!isOle(bytes) || bytes.length < 512) return false;
  const major = bytes.readUInt16LE(26);
  const byteOrder = bytes.readUInt16LE(28);
  const sectorShift = bytes.readUInt16LE(30);
  const miniSectorShift = bytes.readUInt16LE(32);
  const fatSectorCount = bytes.readUInt32LE(44);
  const firstDirectorySector = bytes.readUInt32LE(48);
  const miniCutoff = bytes.readUInt32LE(56);
  const firstMiniFatSector = bytes.readUInt32LE(60);
  const miniFatSectorCount = bytes.readUInt32LE(64);
  const firstDifatSector = bytes.readUInt32LE(68);
  const difatSectorCount = bytes.readUInt32LE(72);
  const sectorSize = 2 ** sectorShift;
  if (byteOrder !== 0xfffe || miniSectorShift !== 6 || miniCutoff !== 4096
    || !((major === 3 && sectorShift === 9) || (major === 4 && sectorShift === 12))
    || fatSectorCount < 1 || fatSectorCount > 2_048 || difatSectorCount > 64
    || miniFatSectorCount > 2_048 || bytes.length < sectorSize * 2 || bytes.length % sectorSize !== 0) return false;
  const sectorCount = bytes.length / sectorSize - 1;
  const sectorOffset = (sector) => (sector + 1) * sectorSize;
  const FREE = 0xffffffff;
  const END = 0xfffffffe;
  const unusedDifatEntry = (sector) => sector === FREE || sector === END;
  const fatSectorIds = [];
  for (let index = 0; index < 109; index += 1) {
    const sector = bytes.readUInt32LE(76 + index * 4);
    if (!unusedDifatEntry(sector)) fatSectorIds.push(sector);
  }
  let difatSector = firstDifatSector;
  const seenDifat = new Set();
  for (let index = 0; index < difatSectorCount; index += 1) {
    if (difatSector >= sectorCount || seenDifat.has(difatSector)) return false;
    seenDifat.add(difatSector);
    const offset = sectorOffset(difatSector);
    const entries = sectorSize / 4 - 1;
    for (let at = 0; at < entries; at += 1) {
      const sector = bytes.readUInt32LE(offset + at * 4);
      if (!unusedDifatEntry(sector)) fatSectorIds.push(sector);
    }
    difatSector = bytes.readUInt32LE(offset + sectorSize - 4);
  }
  if ((difatSectorCount === 0 && !unusedDifatEntry(firstDifatSector))
    || (difatSectorCount > 0 && !unusedDifatEntry(difatSector))
    || fatSectorIds.length !== fatSectorCount) return false;
  const selectedFatIds = fatSectorIds;
  if (new Set(selectedFatIds).size !== selectedFatIds.length
    || selectedFatIds.some((sector) => sector >= sectorCount)) return false;
  const fat = [];
  for (const sector of selectedFatIds) {
    const offset = sectorOffset(sector);
    for (let at = 0; at < sectorSize; at += 4) fat.push(bytes.readUInt32LE(offset + at));
  }
  if (selectedFatIds.some((sector) => fat[sector] !== 0xfffffffd)
    || [...seenDifat].some((sector) => fat[sector] !== 0xfffffffc)) return false;
  let directorySectors;
  try {
    directorySectors = cfbChain(fat, firstDirectorySector, sectorCount, sectorCount);
  } catch {
    return false;
  }
  if (directorySectors.length > 2_048) throw publicError('file-archive-too-large', 413);
  const directory = Buffer.concat(directorySectors.map((sector) => (
    bytes.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize)
  )));
  const directoryEntries = [];
  let root = null;
  let totalDeclared = 0;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const index = offset / 128;
    const nameLength = directory.readUInt16LE(offset + 64);
    const type = directory[offset + 66];
    if (type === 0) {
      directoryEntries[index] = null;
      continue;
    }
    if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) return false;
    const name = directory.subarray(offset, offset + nameLength - 2).toString('utf16le');
    const entry = {
      index,
      name,
      type,
      left: directory.readUInt32LE(offset + 68),
      right: directory.readUInt32LE(offset + 72),
      child: directory.readUInt32LE(offset + 76),
      start: directory.readUInt32LE(offset + 116),
      size: 0,
    };
    directoryEntries[index] = entry;
    if (type === 5) {
      if (index !== 0 || name !== 'Root Entry' || root
        || entry.left !== 0xffffffff || entry.right !== 0xffffffff) return false;
      const size64 = directory.readBigUInt64LE(offset + 120);
      if (size64 > BigInt(bytes.length)) return false;
      entry.size = Number(size64);
      root = entry;
      continue;
    }
    if (type !== 1 && type !== 2) return false;
    if (type === 2 && entry.child !== 0xffffffff) return false;
    const size64 = directory.readBigUInt64LE(offset + 120);
    if (size64 > BigInt(256 * 1024 * 1024)) throw publicError('file-archive-too-large', 413);
    const size = Number(size64);
    entry.size = size;
    totalDeclared += size;
    if (totalDeclared > 256 * 1024 * 1024 || size > bytes.length) {
      throw publicError('file-archive-too-large', 413);
    }
  }
  if (!root || root.child === 0xffffffff) return false;
  const reachable = new Set();
  const pending = [root.child];
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === 0xffffffff) continue;
    if (index >= directoryEntries.length || reachable.has(index)) return false;
    const entry = directoryEntries[index];
    if (!entry || entry.type === 5) return false;
    reachable.add(index);
    pending.push(entry.left, entry.right);
    if (entry.type === 1) pending.push(entry.child);
  }
  const targetStreams = new Map();
  for (const index of reachable) {
    const entry = directoryEntries[index];
    if (entry.type !== 2 || (entry.name !== 'PowerPoint Document' && entry.name !== 'Current User')) continue;
    if (targetStreams.has(entry.name)) return false;
    targetStreams.set(entry.name, entry);
  }
  if (!targetStreams.has('PowerPoint Document') || !targetStreams.has('Current User')) return false;

  let rootMiniStream = null;
  let miniFat = null;
  const readStream = ({ start, size }) => {
    if (size < 1) return null;
    try {
      if (size >= miniCutoff) {
        const chain = cfbChain(fat, start, sectorCount, sectorCount);
        if (chain.length * sectorSize < size) return null;
        return {
          size,
          read: (offset, length) => cfbStreamSlice(bytes, chain, sectorOffset, sectorSize, size, offset, length),
        };
      }
      if (!rootMiniStream) {
        if (root.size < 1 || root.size > bytes.length) return null;
        const rootChain = cfbChain(fat, root.start, sectorCount, sectorCount);
        rootMiniStream = cfbStream(bytes, rootChain, sectorOffset, sectorSize, root.size);
        if (!rootMiniStream) return null;
      }
      if (!miniFat) {
        if (miniFatSectorCount < 1 || firstMiniFatSector === 0xfffffffe) return null;
        const miniFatChain = cfbChain(fat, firstMiniFatSector, sectorCount, sectorCount);
        if (miniFatChain.length !== miniFatSectorCount) return null;
        const miniFatBytes = cfbStream(
          bytes,
          miniFatChain,
          sectorOffset,
          sectorSize,
          miniFatSectorCount * sectorSize,
        );
        if (!miniFatBytes) return null;
        miniFat = [];
        for (let at = 0; at < miniFatBytes.length; at += 4) miniFat.push(miniFatBytes.readUInt32LE(at));
      }
      const miniSectorSize = 2 ** miniSectorShift;
      const miniSectorCount = Math.ceil(rootMiniStream.length / miniSectorSize);
      const chain = cfbChain(miniFat, start, miniSectorCount, miniSectorCount);
      if (chain.length * miniSectorSize < size) return null;
      return {
        size,
        read: (offset, length) => cfbStreamSlice(
          rootMiniStream,
          chain,
          (sector) => sector * miniSectorSize,
          miniSectorSize,
          size,
          offset,
          length,
        ),
      };
    } catch {
      return null;
    }
  };
  const documentStream = readStream(targetStreams.get('PowerPoint Document'));
  const currentUserStream = readStream(targetStreams.get('Current User'));
  if (!documentStream || !currentUserStream || currentUserStream.size < 28) return false;
  const currentUserAtom = currentUserStream.read(0, 28);
  const currentHeader = pptRecordHeader(currentUserAtom, currentUserStream.size, 0);
  if (!currentHeader || currentHeader.version !== 0 || currentHeader.instance !== 0
    || currentHeader.type !== 0x0ff6 || currentHeader.length < 20
    || currentUserAtom.readUInt32LE(8) !== 20
    || currentUserAtom.readUInt32LE(12) !== 0xe391c05f
    || currentUserAtom.readUInt16LE(22) !== 0x03f4
    || currentUserAtom[24] !== 3 || currentUserAtom[25] !== 0) return false;
  const currentEditOffset = currentUserAtom.readUInt32LE(16);
  const currentEditBytes = documentStream.read(currentEditOffset, 24);
  const currentEditHeader = pptRecordHeader(currentEditBytes, documentStream.size, currentEditOffset);
  if (!currentEditHeader || currentEditHeader.version !== 0 || currentEditHeader.instance !== 0
    || currentEditHeader.type !== 0x0ff5
    || currentEditHeader.length < 28 || currentEditHeader.length > 32) return false;
  const persistDirectoryOffset = currentEditBytes.readUInt32LE(20);
  const persistDirectoryBytes = documentStream.read(persistDirectoryOffset, 8);
  const persistDirectoryHeader = pptRecordHeader(
    persistDirectoryBytes,
    documentStream.size,
    persistDirectoryOffset,
  );
  return Boolean(persistDirectoryHeader
    && persistDirectoryHeader.version === 0
    && persistDirectoryHeader.instance === 0
    && persistDirectoryHeader.type === 0x1772
    && persistDirectoryHeader.length >= 4);
}

function validUtf8Text(bytes) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 2 * 1024 * 1024)));
    return true;
  } catch {
    return false;
  }
}

function validateFile(bytes, filename, maximum) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw publicError('file-empty');
  if (bytes.length > maximum) throw publicError('file-too-large', 413);
  const extension = path.extname(filename.split('/').at(-1)).toLowerCase();
  const contentType = FILE_TYPES[extension];
  if (!contentType) throw publicError('file-type-unsupported', 415);
  const valid = extension === '.pdf'
    ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : extension === '.ppt'
      ? validLegacyPowerPoint(bytes)
      : extension === '.pptx' || extension === '.docx'
        ? validOoxml(bytes, extension)
        : validUtf8Text(bytes);
  if (!valid) throw publicError('file-content-mismatch', 415);
  return { extension, contentType };
}

function normalizedParseStatus(value) {
  const status = String(value ?? '').toLowerCase();
  return PARSE_STATUSES.has(status) ? status : 'processing';
}

function normalizedEnableStatus(value, parseStatus) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'enabled' || status === 'disabled') return status;
  return parseStatus === 'completed' ? 'enabled' : 'disabled';
}

function upstreamKnowledge(value) {
  const id = String(value?.id ?? value?.knowledge_id ?? '').trim();
  if (!id) throw new Error('weknora-invalid-knowledge');
  const parseStatus = normalizedParseStatus(value?.parse_status ?? value?.parseStatus);
  return {
    id,
    parseStatus,
    enableStatus: normalizedEnableStatus(value?.enable_status ?? value?.enableStatus, parseStatus),
    errorMessage: parseStatus === 'failed' ? '资料解析失败，可尝试重新解析' : null,
  };
}

function chunkContent(value) {
  return String(
    value?.content
    ?? value?.text
    ?? value?.chunk_content
    ?? value?.chunk?.content
    ?? value?.document?.content
    ?? '',
  ).trim();
}

function chunkId(value) {
  return String(value?.id ?? value?.chunk_id ?? value?.chunkId ?? value?.chunk?.id ?? '').trim();
}

function sourceOverlap(query, content) {
  const wanted = new Set();
  const normalized = String(query).toLowerCase();
  for (const word of normalized.match(/[a-z0-9_+-]{2,}/g) ?? []) wanted.add(word);
  for (const sequence of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    for (let size = 2; size <= Math.min(4, sequence.length); size += 1) {
      for (let index = 0; index + size <= sequence.length; index += 1) {
        wanted.add(sequence.slice(index, index + size));
      }
    }
  }
  if (wanted.size === 0) return 0;
  const haystack = String(content).toLowerCase();
  let matched = 0;
  for (const token of wanted) if (haystack.includes(token)) matched += 1;
  return matched / wanted.size;
}

function bestGroundedChunk(item, chunks) {
  const query = `${item.point} ${item.groundTruth} ${(item.terms ?? []).join(' ')}`;
  let best = null;
  let bestScore = 0;
  for (const chunk of chunks) {
    const score = sourceOverlap(query, chunk.content);
    if (score > bestScore) {
      best = chunk;
      bestScore = score;
    }
  }
  return bestScore >= 0.15 ? best : null;
}

function stableCompilerError(error) {
  const code = String(error?.message ?? 'compile-failed').split(':', 1)[0];
  const allowed = new Set([
    'compiler-no-chunks', 'compiler-invalid-json', 'compiler-timeout', 'compiler-rate-limited',
    'compiler-upstream-failed', 'compiler-empty', 'weknora-timeout', 'weknora-unreachable',
    'weknora-upstream-failed',
  ]);
  return allowed.has(code) ? code : 'compile-failed';
}

function publicCourse(course) {
  return {
    id: course.id,
    title: course.title,
    assetCount: course.assetCount ?? 0,
    topicCount: course.topicCount ?? 0,
    createdAt: course.createdAt,
  };
}

function publicAsset(asset) {
  return {
    id: asset.id,
    courseId: asset.courseId,
    assetRole: asset.assetRole,
    filename: asset.filename,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    wkKnowledgeId: asset.wkKnowledgeId,
    parseStatus: asset.parseStatus,
    enableStatus: asset.enableStatus,
    errorMessage: asset.errorMessage,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function faqEntry(mc) {
  return {
    standard_question: mc.belief,
    similar_questions: [mc.triggerLine],
    negative_questions: mc.correctionCriteria.slice(0, 3),
    answers: [mc.correctionCriteria.join('；')],
    is_enabled: true,
    is_recommended: false,
  };
}

function publicSemanticEvaluation(value, topic) {
  const checklistIds = new Set(topic.checklist.map((item) => item.id));
  const checklistHits = (Array.isArray(value?.checklistHits) ? value.checklistHits : [])
    .map((item) => ({
      id: cleanText(item?.id, 40),
      quote: cleanMultiline(item?.quote, 200),
    }))
    .filter((item) => checklistIds.has(item.id) && item.quote)
    .slice(0, 7);
  const accuracyFlags = (Array.isArray(value?.accuracyFlags) ? value.accuracyFlags : [])
    .map((item) => ({
      checklistId: cleanText(item?.checklistId, 40),
      note: cleanMultiline(item?.note, 240),
    }))
    .filter((item) => checklistIds.has(item.checklistId) && item.note)
    .slice(0, 3);
  const judgement = value?.mcJudgement;
  return {
    checklistHits,
    mcJudgement: judgement === 'corrected' || judgement === 'adopted' || judgement === 'pending'
      ? judgement
      : null,
    accuracyFlags,
    stuckSignal: value?.stuckSignal === true,
    offTopic: value?.offTopic === true,
    answeredTangent: value?.answeredTangent === true,
    goldenAnalogy: cleanMultiline(value?.goldenAnalogy, 1_000) || null,
    reasoning: cleanMultiline(value?.reasoning, 500),
  };
}

export function createCustomContentService({
  repository,
  weknora,
  cos,
  compiler,
  embeddingModelId,
  summaryModelId,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  logger = console,
} = {}) {
  if (!repository?.courses || !repository?.assets || !repository?.topics || !repository?.jobs) {
    throw new Error('custom-content-repository-required');
  }
  if (!weknora?.createKnowledgeBase || !weknora?.uploadFile || !weknora?.findKnowledgeByMetadata) {
    throw new Error('weknora-client-required');
  }
  if (!cos?.createCustomCourseAssetKey || !cos?.uploadCustomCourseAsset || !cos?.verifySize || !cos?.delete) {
    throw new Error('custom-content-cos-required');
  }
  if (!compiler?.compile) throw new Error('topic-compiler-required');
  if (!embeddingModelId) throw new Error('weknora-embedding-model-required');
  const runningJobs = new Map();
  const queuedJobIds = new Set();
  const compileQueue = [];
  const maxConcurrentCompiles = 2;
  let activeCompiles = 0;

  const kbBase = (name, type) => ({
    name,
    description: '小白同学自定义课程 sidecar 知识库',
    type,
    embedding_model_id: embeddingModelId,
    ...(summaryModelId ? { summary_model_id: summaryModelId } : {}),
    chunking_config: {
      strategy: 'heading',
      chunk_size: 512,
      chunk_overlap: 80,
      enable_parent_child: true,
      parent_chunk_size: 4096,
      child_chunk_size: 384,
      separators: ['\n\n', '\n', '。', '！', '？'],
    },
    indexing_strategy: {
      vector_enabled: true,
      keyword_enabled: true,
      wiki_enabled: false,
      graph_enabled: false,
    },
    question_generation_config: { enabled: false },
  });

  async function requireCourse(ownerId, courseId) {
    const course = await repository.courses.findOwned(ownerId, courseId).catch(() => null);
    if (!course) throw publicError('course-not-found', 404);
    return course;
  }

  async function compensateCos(userId, key, reason, { repeat = false } = {}) {
    if (!key) return true;
    const attempts = repeat ? 2 : 1;
    let lastFailed = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        await cos.delete({ userId, key });
        lastFailed = false;
      } catch {
        lastFailed = true;
      }
    }
    if (lastFailed) logger.error?.(`[custom-content] COS compensation failed: ${reason}`);
    return !lastFailed;
  }

  async function compensateKnowledgeBase(id, requestId, { repeat = false } = {}) {
    if (!id) return true;
    const attempts = repeat ? 2 : 1;
    let lastFailed = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        await weknora.deleteKnowledgeBase(id, requestId).catch((error) => {
          if (!String(error?.message).startsWith('weknora-not-found')) throw error;
        });
        lastFailed = false;
      } catch {
        lastFailed = true;
      }
    }
    return !lastFailed;
  }

  async function refreshAsset(asset, requestId) {
    if (asset.parseStatus === 'deleting') return asset;
    if (weknora.isTerminalParseStatus(asset.parseStatus)) return asset;
    try {
      const status = upstreamKnowledge(await weknora.getKnowledge(asset.wkKnowledgeId, requestId));
      if (
        status.parseStatus === asset.parseStatus
        && status.enableStatus === asset.enableStatus
        && status.errorMessage === asset.errorMessage
      ) return asset;
      return await repository.assets.updateStatus(asset.id, status) ?? asset;
    } catch (error) {
      if (String(error?.message).startsWith('weknora-not-found')) {
        return await repository.assets.updateStatus(asset.id, {
          parseStatus: 'failed', enableStatus: 'disabled', errorMessage: '资料在解析服务中不存在',
        }) ?? asset;
      }
      return asset;
    }
  }

  async function reconcileUploadIntent(intent) {
    let knowledgeId = intent.wkKnowledgeId;
    try {
      if (!knowledgeId) {
        const ambiguous = await weknora.findKnowledgeByMetadata({
          kbId: intent.wkDocKbId,
          key: 'xiaobai_upload_marker',
          value: intent.id,
          requestId: `xb-upload-reconcile-${intent.id}`,
          maximumWaitMs: 0,
        });
        knowledgeId = String(ambiguous?.id ?? ambiguous?.knowledge_id ?? '').trim() || null;
      }
      if (knowledgeId) {
        await weknora.deleteKnowledge(knowledgeId, `xb-upload-reconcile-${intent.id}`).catch((error) => {
          if (!String(error?.message).startsWith('weknora-not-found')) throw error;
        });
      }
      await cos.delete({ userId: intent.ownerId, key: intent.cosKey });
      await repository.assets.removeUploadIntent(intent.ownerId, intent.id);
      return true;
    } catch {
      logger.error?.('[custom-content] stale upload intent reconciliation failed');
      return false;
    }
  }

  async function reconcileCourseCreationIntent(intent) {
    const requestId = `xb-course-reconcile-${intent.id}`;
    const results = await Promise.all([
      compensateKnowledgeBase(intent.wkDocKbId, requestId),
      compensateKnowledgeBase(intent.wkFaqKbId, requestId),
    ]);
    if (results.every(Boolean)) {
      await repository.courses.removeCreationIntent(intent.ownerId, intent.id);
      return true;
    }
    logger.error?.('[custom-content] stale course creation intent reconciliation failed');
    return false;
  }

  async function loadOwnedTopic(ownerId, id) {
    const topic = await repository.topics.findOwned(ownerId, id).catch(() => null);
    if (!topic) throw publicError('topic-not-found', 404);
    return topic;
  }

  async function hydrateDraftSources(course, current, candidate, requestId) {
    const sourceIds = (current.payload?.sources ?? []).map((source) => source.assetId).filter(Boolean);
    const assets = sourceIds.length
      ? await repository.assets.findManyByCourse(course.id, sourceIds)
      : [];
    const sourceAssets = assets.map((asset) => ({
      id: asset.id,
      wkKnowledgeId: asset.wkKnowledgeId,
      filename: asset.filename,
      assetRole: asset.assetRole,
    }));
    const chunkLists = await Promise.all(
      assets.map((asset) => weknora.listChunks(asset.wkKnowledgeId, requestId, 500)),
    );
    const chunks = chunkLists.flat().map((value) => ({ id: chunkId(value), content: chunkContent(value) }))
      .filter((chunk) => chunk.id && chunk.content);
    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk.content]));
    const normalized = normalizeTopicDraft(candidate, {
      topicId: current.topicId,
      courseTitle: course.title,
      sourceAssets,
      promptVersion: current.promptVersion,
      model: current.payload?.compileMeta?.model ?? '',
    });
    normalized.compileMeta.teacherEdited = true;
    const knowledgeIds = sourceAssets.map((asset) => asset.wkKnowledgeId);
    await Promise.all(normalized.checklist.map(async (item) => {
      const query = `${item.point} ${item.groundTruth} ${(item.terms ?? []).join(' ')}`;
      const validIds = item.sourceChunkIds.filter((id) => chunkMap.has(id));
      const supportedId = validIds.find((id) => sourceOverlap(query, chunkMap.get(id) ?? '') >= 0.15);
      let selected = supportedId
        ? { id: supportedId, content: chunkMap.get(supportedId) }
        : bestGroundedChunk(item, chunks);

      if (!selected && knowledgeIds.length > 0) {
        try {
          const hits = await weknora.search({
            kbId: course.wkDocKbId,
            query,
            knowledgeIds,
            requestId,
          });
          const candidates = hits.map((hit) => ({ id: chunkId(hit), content: chunkContent(hit) }))
            .filter((hit) => hit.id && hit.content);
          selected = bestGroundedChunk(item, candidates);
          if (selected) chunkMap.set(selected.id, selected.content);
        } catch {
          // 本地分块仍是保存闸门的证据；检索暂时不可用时不放宽出处校验。
        }
      }

      item.sourceChunkIds = selected?.id ? [selected.id] : [];
      item.sourceExcerpt = selected?.content
        ? selected.content.replace(/\s+/g, ' ').slice(0, 800)
        : '';
    }));
    const sourceCorpus = [...new Set(chunkMap.values())].join('\n');
    const issues = validateTopicDraft(normalized, { sourceCorpus });
    for (const [index, item] of normalized.checklist.entries()) {
      const supported = item.sourceChunkIds.some((id) => (
        sourceOverlap(`${item.point} ${item.groundTruth}`, chunkMap.get(id) ?? '') >= 0.15
      ));
      if (!supported) {
        issues.push({
          code: 'ground-truth-not-grounded',
          path: `checklist.${index}.groundTruth`,
          message: '修改后的评估依据与所选课件片段关联过弱',
          level: 'error',
        });
      }
    }
    return { normalized, issues };
  }

  async function runJob(jobId) {
    if (runningJobs.has(jobId)) return runningJobs.get(jobId);
    const task = (async () => {
      const leaseToken = crypto.randomUUID();
      const job = await repository.jobs.claimForRun(jobId, leaseToken);
      if (!job) return;
      try {
        const course = await repository.courses.findById(job.courseId);
        if (!course) throw new Error('course-not-found');
        const assets = await repository.assets.findManyByCourse(job.courseId, job.assetIds);
        if (assets.length !== job.assetIds.length || assets.some((asset) => asset.parseStatus !== 'completed')) {
          throw new Error('assets-not-ready');
        }
        const topicId = `custom-${course.id}-${job.id}`;
        const result = await compiler.compile({
          course,
          assets,
          topicId,
          requestedTitle: job.requestedTitle,
          requestId: `xb-compile-${job.id}`,
        });
        const attached = await repository.jobs.createDraftAndAttach({
          jobId: job.id,
          leaseToken,
          topicId,
          courseId: course.id,
          payload: result.topic,
          qualityIssues: result.qualityIssues,
          promptVersion: TOPIC_PROMPT_VERSION,
        });
        if (!attached) throw new Error('compile-attach-failed');
      } catch (error) {
        logger.error?.('[custom-content] compile failed:', stableCompilerError(error));
        await repository.jobs.transitionClaimed(job.id, leaseToken, {
          status: 'failed',
          errorCode: stableCompilerError(error),
        }).catch(() => {});
      }
    })().finally(() => runningJobs.delete(jobId));
    runningJobs.set(jobId, task);
    return task;
  }

  function pumpCompileQueue() {
    while (activeCompiles < maxConcurrentCompiles && compileQueue.length > 0) {
      const jobId = compileQueue.shift();
      queuedJobIds.delete(jobId);
      activeCompiles += 1;
      void runJob(jobId).finally(() => {
        activeCompiles -= 1;
        pumpCompileQueue();
      });
    }
  }

  function scheduleJob(jobId) {
    if (runningJobs.has(jobId) || queuedJobIds.has(jobId)) return;
    queuedJobIds.add(jobId);
    compileQueue.push(jobId);
    queueMicrotask(pumpCompileQueue);
  }

  async function reconcileClaimedIntents(intents, reconcile, concurrency = 4) {
    let cursor = 0;
    let cleaned = 0;
    const workerCount = Math.min(concurrency, intents.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < intents.length) {
        const index = cursor;
        cursor += 1;
        try {
          if (await reconcile(intents[index])) cleaned += 1;
        } catch {
          logger.error?.('[custom-content] stale intent reconciliation worker failed');
        }
      }
    }));
    return { scanned: intents.length, cleaned };
  }

  async function jobWithTopic(owner, job) {
    if (!job) return null;
    if ((job.status === 'queued' || job.status === 'running') && !runningJobs.has(job.id)) scheduleJob(job.id);
    const topic = job.topicId ? await repository.topics.findOwned(owner.id, job.topicId) : null;
    if (job.status === 'needs_review' && topic?.status === 'ready') {
      await repository.jobs.markDoneForTopic(topic.id);
      return null;
    }
    return { ...job, topic };
  }

  return Object.freeze({
    maxFileBytes,

    async status() {
      return { configured: true, healthy: await weknora.healthCheck() };
    },

    async createCourse(owner, titleValue, requestId) {
      const title = cleanText(titleValue, COURSE_TITLE_MAX);
      if (title.length < 2) throw publicError('course-title-invalid');
      const docId = crypto.randomUUID();
      const faqId = crypto.randomUUID();
      const intent = await repository.courses.createCreationIntent({
        ownerId: owner.id,
        title,
        wkDocKbId: docId,
        wkFaqKbId: faqId,
      });
      if (!intent) throw publicError('course-create-upstream-failed', 502);
      const suffix = intent.id.slice(0, 8);
      const [docResult, faqResult] = await Promise.allSettled([
        weknora.createKnowledgeBase({ id: docId, ...kbBase(`小白·${title}·资料·${suffix}`, 'document') }, requestId),
        weknora.createKnowledgeBase({ id: faqId, ...kbBase(`小白·${title}·误区·${suffix}`, 'faq') }, requestId),
      ]);
      if (docResult.status !== 'fulfilled' || faqResult.status !== 'fulfilled') {
        await Promise.all([
          compensateKnowledgeBase(docId, requestId, { repeat: true }),
          compensateKnowledgeBase(faqId, requestId, { repeat: true }),
        ]);
        throw publicError('course-create-upstream-failed', 502);
      }
      const returnedDocId = String(docResult.value?.id ?? '').trim();
      const returnedFaqId = String(faqResult.value?.id ?? '').trim();
      if (returnedDocId !== docId || returnedFaqId !== faqId) {
        await Promise.all([
          compensateKnowledgeBase(returnedDocId || docId, requestId, { repeat: true }),
          compensateKnowledgeBase(returnedFaqId || faqId, requestId, { repeat: true }),
        ]);
        throw publicError('course-create-upstream-failed', 502);
      }
      try {
        const course = await repository.courses.finalizeCreationIntent(owner.id, intent.id);
        if (!course) throw new Error('course-create-intent-missing');
        return publicCourse(course);
      } catch (error) {
        const committed = await repository.courses.findOwnedByKnowledgeBaseIds(
          owner.id,
          docId,
          faqId,
        ).catch(() => null);
        if (committed) return publicCourse(committed);
        await Promise.all([
          compensateKnowledgeBase(docId, requestId, { repeat: true }),
          compensateKnowledgeBase(faqId, requestId, { repeat: true }),
        ]);
        throw error;
      }
    },

    async listCourses(owner) {
      return (await repository.courses.listByOwner(owner.id)).map(publicCourse);
    },

    async getCourse(owner, courseId) {
      const course = await requireCourse(owner.id, courseId);
      const assets = await repository.assets.listOwned(owner.id, course.id);
      const refreshed = await Promise.all(assets.map((asset) => refreshAsset(asset, `xb-assets-${course.id}`)));
      return { ...publicCourse(course), assets: refreshed.map(publicAsset) };
    },

    async uploadAsset(owner, courseId, {
      bytes,
      filename: filenameValue,
      assetRole: roleValue,
      requestId,
    }) {
      const course = await requireCourse(owner.id, courseId);
      const filename = cleanFilename(filenameValue);
      const assetRole = ASSET_ROLES.has(roleValue) ? roleValue : 'lecture';
      const { contentType } = validateFile(bytes, filename, maxFileBytes);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const plannedCosKey = cos.createCustomCourseAssetKey({ userId: owner.id, courseId: course.id });
      const intent = await repository.assets.createUploadIntent({
        ownerId: owner.id,
        courseId: course.id,
        cosKey: plannedCosKey,
      });
      if (!intent) throw publicError('asset-storage-failed', 502);
      const uploadMarker = intent.id;
      let stored = { key: plannedCosKey };
      try {
        stored = await cos.uploadCustomCourseAsset({
          userId: owner.id,
          courseId: course.id,
          key: plannedCosKey,
          body: bytes,
          contentType,
        });
        const verified = await cos.verifySize({ userId: owner.id, key: stored.key });
        if (verified.byteSize !== bytes.length) throw new Error('cos-object-size-mismatch');
      } catch {
        // PUT 超时可能是“服务端已落盘、客户端没收到响应”；已预生成 key，并延迟再删一次收窄歧义窗。
        await compensateCos(owner.id, plannedCosKey, 'verify-upload', { repeat: true });
        // 即时删除成功也保留 intent：迟到的 PUT 仍可能在超时响应之后落盘，由周期清扫再次确认。
        throw publicError('asset-storage-failed', 502);
      }
      let uploaded;
      try {
        uploaded = upstreamKnowledge(await weknora.uploadFile(course.wkDocKbId, {
          bytes,
          filename,
          contentType,
          metadata: {
            xiaobai_course_id: course.id,
            xiaobai_upload_marker: uploadMarker,
            asset_role: assetRole,
            sha256,
          },
          processConfig: {
            parser_engine_rules: [
              { file_types: ['.ppt', '.pptx', '.pdf', '.docx', '.md', '.txt'], engine: 'builtin' },
            ],
            chunking_config: {
              strategy: 'heading', chunk_size: 512, chunk_overlap: 80,
              enable_parent_child: true, parent_chunk_size: 4096, child_chunk_size: 384,
              separators: ['\n\n', '\n', '。', '！', '？'],
            },
            enable_multimodel: false,
            question_generation_config: { enabled: false },
            graph_enabled: false,
          },
          requestId,
        }));
      } catch (error) {
        let reconciled = true;
        const ambiguousFailure = error?.retryable === true
          || /weknora-(?:timeout|unreachable)/.test(String(error?.message));
        if (ambiguousFailure) {
          try {
            const ambiguous = await weknora.findKnowledgeByMetadata({
              kbId: course.wkDocKbId,
              key: 'xiaobai_upload_marker',
              value: uploadMarker,
              requestId,
            });
            const ambiguousId = String(ambiguous?.id ?? ambiguous?.knowledge_id ?? '').trim();
            if (ambiguousId) await weknora.deleteKnowledge(ambiguousId, requestId);
          } catch {
            reconciled = false;
            logger.error?.('[custom-content] ambiguous WeKnora upload reconciliation failed');
          }
        }
        const cosCleaned = await compensateCos(owner.id, stored.key, 'weknora-upload');
        if (!ambiguousFailure && reconciled && cosCleaned) {
          await repository.assets.removeUploadIntent(owner.id, intent.id).catch(() => {});
        }
        if (String(error?.message).startsWith('weknora-conflict')) throw publicError('asset-duplicate', 409);
        if (String(error?.message).startsWith('weknora-file-too-large')) throw publicError('file-too-large', 413);
        throw publicError('asset-upload-upstream-failed', 502);
      }
      try {
        const intentWithKnowledge = await repository.assets.setUploadIntentKnowledge(
          owner.id,
          intent.id,
          uploaded.id,
        );
        if (!intentWithKnowledge) throw new Error('upload-intent-missing');
        const asset = await repository.assets.finalizeUploadIntent(owner.id, intent.id, {
          courseId: course.id,
          assetRole,
          filename,
          contentType,
          byteSize: bytes.length,
          sha256,
          wkKnowledgeId: uploaded.id,
          parseStatus: uploaded.parseStatus,
          enableStatus: uploaded.enableStatus,
          errorMessage: uploaded.errorMessage,
        });
        if (!asset) throw new Error('upload-intent-finalize-failed');
        return publicAsset(asset);
      } catch (error) {
        const committed = await repository.assets.findOwnedByStorageRefs(
          owner.id,
          stored.key,
          uploaded.id,
        ).catch(() => null);
        if (committed) return publicAsset(committed);
        const cleanup = await Promise.allSettled([
          weknora.deleteKnowledge(uploaded.id, requestId),
          cos.delete({ userId: owner.id, key: stored.key }),
        ]);
        if (cleanup.some((result) => result.status === 'rejected')) {
          logger.error?.('[custom-content] upload compensation incomplete');
        } else {
          await repository.assets.removeUploadIntent(owner.id, intent.id).catch(() => {});
        }
        if (error?.code === '23505') throw publicError('asset-duplicate', 409);
        throw error;
      }
    },

    async listAssets(owner, courseId) {
      const course = await requireCourse(owner.id, courseId);
      const assets = await repository.assets.listOwned(owner.id, course.id);
      return (await Promise.all(assets.map((asset) => refreshAsset(asset, `xb-assets-${course.id}`))))
        .map(publicAsset);
    },

    async getAsset(owner, assetId, requestId) {
      const asset = await repository.assets.findOwned(owner.id, assetId).catch(() => null);
      if (!asset) throw publicError('asset-not-found', 404);
      return publicAsset(await refreshAsset(asset, requestId));
    },

    async reparseAsset(owner, assetId, requestId) {
      const asset = await repository.assets.findOwned(owner.id, assetId).catch(() => null);
      if (!asset) throw publicError('asset-not-found', 404);
      const stored = await cos.verifySize({ userId: owner.id, key: asset.cosKey }).catch(() => null);
      if (!stored || stored.byteSize !== asset.byteSize) throw publicError('asset-storage-missing', 409);
      await weknora.reparseKnowledge(asset.wkKnowledgeId, {}, requestId).catch(() => {
        throw publicError('asset-reparse-upstream-failed', 502);
      });
      return publicAsset(await repository.assets.updateStatus(asset.id, {
        parseStatus: 'pending', enableStatus: 'disabled', errorMessage: null,
      }));
    },

    async deleteAsset(owner, assetId, requestId) {
      const asset = await repository.assets.findOwned(owner.id, assetId).catch(() => null);
      if (!asset) throw publicError('asset-not-found', 404);
      const claimed = await repository.assets.claimDelete(owner.id, asset.id);
      if (!claimed) throw publicError('asset-in-use', 409);
      let knowledgeDeleted = false;
      try {
        await weknora.deleteKnowledge(asset.wkKnowledgeId, requestId).catch((error) => {
          if (!String(error?.message).startsWith('weknora-not-found')) throw error;
        });
        knowledgeDeleted = true;
        await cos.delete({ userId: owner.id, key: asset.cosKey });
      } catch {
        await repository.assets.updateStatus(asset.id, knowledgeDeleted ? {
          parseStatus: 'failed',
          enableStatus: 'disabled',
          errorMessage: '资料删除未完成，可再次删除重试',
        } : {
          parseStatus: asset.parseStatus,
          enableStatus: asset.enableStatus,
          errorMessage: asset.errorMessage,
        }).catch(() => {});
        throw publicError(knowledgeDeleted ? 'asset-storage-delete-failed' : 'asset-delete-upstream-failed', 502);
      }
      await repository.assets.remove(asset.id);
      return { ok: true };
    },

    async startCompile(owner, input) {
      const course = await requireCourse(owner.id, input?.courseId);
      const assetIds = Array.isArray(input?.assetIds) ? [...new Set(input.assetIds)] : [];
      if (assetIds.length === 0 || assetIds.length > 12) throw publicError('assets-required');
      const assets = await repository.assets.findManyOwned(owner.id, course.id, assetIds).catch(() => []);
      if (assets.length !== assetIds.length) throw publicError('asset-not-found', 404);
      if (assets.some((asset) => asset.parseStatus !== 'completed')) throw publicError('assets-not-ready', 409);
      const openJob = await repository.jobs.findOpenByCourse(course.id);
      if (await jobWithTopic(owner, openJob)) throw publicError('compile-job-active', 409);
      const requestedTitle = cleanText(input?.title, TOPIC_TITLE_MAX) || null;
      let job;
      try {
        job = await repository.jobs.create({ courseId: course.id, assetIds, requestedTitle });
      } catch (error) {
        if (error?.code === '23505') throw publicError('compile-job-active', 409);
        const committed = await repository.jobs.findOpenByCourse(course.id).catch(() => null);
        const sameAssets = committed
          && committed.assetIds.length === assetIds.length
          && committed.assetIds.every((id) => assetIds.includes(id));
        if (sameAssets && committed.requestedTitle === requestedTitle) job = committed;
        else throw error;
      }
      if (!job) throw publicError('assets-not-ready', 409);
      scheduleJob(job.id);
      return job;
    },

    async getCompileJob(owner, jobId) {
      const job = await repository.jobs.findOwned(owner.id, jobId).catch(() => null);
      if (!job) throw publicError('compile-job-not-found', 404);
      return jobWithTopic(owner, job);
    },

    async getCourseCompileJob(owner, courseId) {
      const course = await requireCourse(owner.id, courseId);
      return jobWithTopic(owner, await repository.jobs.findOpenByCourse(course.id));
    },

    async reconcileUploadIntents() {
      const intents = await repository.assets.claimStaleUploadIntents();
      return reconcileClaimedIntents(intents, reconcileUploadIntent);
    },

    async reconcileCourseCreationIntents() {
      const intents = await repository.courses.claimStaleCreationIntents();
      return reconcileClaimedIntents(intents, reconcileCourseCreationIntent);
    },

    async findSourceCandidates(owner, id, input, requestId) {
      const current = await loadOwnedTopic(owner.id, id);
      if (current.status !== 'draft') throw publicError('topic-not-editable', 409);
      const point = cleanText(input?.point, 160);
      const groundTruth = cleanText(input?.groundTruth, 2_000);
      if (point.length < 2 || groundTruth.length < 4) throw publicError('source-query-invalid');
      const sourceIds = (current.payload?.sources ?? []).map((source) => source.assetId).filter(Boolean);
      const assets = sourceIds.length
        ? await repository.assets.findManyByCourse(current.courseId, sourceIds)
        : [];
      const chunkLists = await Promise.all(assets.map(async (asset) => (
        (await weknora.listChunks(asset.wkKnowledgeId, requestId, 500)).map((value) => ({
          id: chunkId(value),
          content: chunkContent(value),
          assetId: asset.id,
          filename: asset.filename,
        }))
      )));
      const query = `${point} ${groundTruth}`;
      return chunkLists.flat()
        .filter((chunk) => chunk.id && chunk.content)
        .map((chunk) => ({ ...chunk, score: sourceOverlap(query, chunk.content) }))
        .filter((chunk) => chunk.score >= 0.15)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, 5)
        .map((chunk) => ({
          chunkId: chunk.id,
          assetId: chunk.assetId,
          filename: chunk.filename,
          excerpt: chunk.content.replace(/\s+/g, ' ').slice(0, 800),
        }));
    },

    async evaluateTopic(owner, topicId, input, requestId) {
      if (typeof compiler.evaluateSemantic !== 'function') throw publicError('custom-evaluator-unavailable', 503);
      const record = await repository.topics.findReadyOwnedByTopicId(owner.id, topicId);
      if (!record) throw publicError('topic-not-found', 404);
      const utterance = cleanMultiline(input?.utterance, 20_000);
      const lastXiaobaiText = cleanMultiline(input?.lastXiaobaiText, 4_000) || null;
      if (!utterance) throw publicError('evaluation-utterance-required');
      const checklistIds = new Set(record.payload.checklist.map((item) => item.id));
      const hitChecklist = Array.isArray(input?.hitChecklist)
        ? [...new Set(input.hitChecklist.map((id) => cleanText(id, 40)).filter((id) => checklistIds.has(id)))].slice(0, 7)
        : [];
      const pendingMcId = cleanText(input?.pendingMcId, 100) || null;
      if (pendingMcId && !record.payload.misconceptions.some((item) => item.mcId === pendingMcId)) {
        throw publicError('evaluation-misconception-invalid');
      }
      const result = await compiler.evaluateSemantic({
        topic: record.payload,
        utterance,
        lastXiaobaiText,
        hitChecklist,
        pendingMcId,
        requestId,
      }).catch((error) => {
        throw publicError(stableCompilerError(error), 502);
      });
      return publicSemanticEvaluation(result, record.payload);
    },

    async updateDraft(owner, id, candidate, requestId) {
      const current = await loadOwnedTopic(owner.id, id);
      if (current.status !== 'draft') throw publicError('topic-not-editable', 409);
      const course = await requireCourse(owner.id, current.courseId);
      const { normalized, issues } = await hydrateDraftSources(course, current, candidate, requestId);
      const updated = await repository.topics.updateDraft(current.id, teacherEditableDraft(normalized), issues);
      if (!updated) throw publicError('topic-not-editable', 409);
      return updated;
    },

    async discardDraft(owner, id) {
      const current = await loadOwnedTopic(owner.id, id);
      if (current.status !== 'draft') throw publicError('topic-not-editable', 409);
      let archived;
      try {
        archived = await repository.topics.discardDraft(owner.id, current.id);
      } catch (error) {
        const committed = await repository.topics.findOwned(owner.id, current.id).catch(() => null);
        if (committed?.status === 'archived') return { ok: true };
        throw error;
      }
      if (!archived) throw publicError('topic-not-editable', 409);
      return { ok: true };
    },

    async publishTopic(owner, id, requestId) {
      const current = await loadOwnedTopic(owner.id, id);
      if (current.status !== 'draft') throw publicError('topic-not-editable', 409);
      const course = await requireCourse(owner.id, current.courseId);
      const { normalized, issues } = await hydrateDraftSources(course, current, current.payload, requestId);
      if (hasBlockingIssues(issues)) {
        await repository.topics.updateDraft(current.id, normalized, issues);
        throw publicError('topic-quality-gate-failed', 409);
      }
      const existing = await repository.topics.listReadyByCourse(course.id);
      const faqEntries = [...existing.map((topic) => topic.payload), normalized]
        .flatMap((topic) => topic.misconceptions ?? [])
        .map(faqEntry);
      if (course.wkFaqKbId && faqEntries.length > 0) {
        await (async () => {
          const task = await weknora.upsertFaqEntries(course.wkFaqKbId, faqEntries, requestId);
          if (!task?.task_id) throw new Error('faq-task-missing');
          await weknora.waitForFaqImport(task.task_id, requestId);
        })().catch(() => {
          throw publicError('faq-sync-failed', 502);
        });
      }
      let published;
      try {
        published = await repository.topics.publishValidated(
          current.id,
          current.payload,
          normalized,
        );
      } catch (error) {
        const committed = await repository.topics.findReadyOwnedByTopicId(owner.id, current.topicId)
          .catch(() => null);
        if (committed) return committed;
        throw error;
      }
      if (!published) throw publicError('topic-not-editable', 409);
      return published;
    },

    async listPublishedTopics(owner) {
      return (await repository.topics.listReadyByOwner(owner.id)).map((topic) => ({
        ...studentTopicView(topic.payload),
        customCourseId: topic.courseId,
      }));
    },

    async getPublishedTopic(owner, topicId) {
      const topic = await repository.topics.findReadyOwnedByTopicId(owner.id, topicId);
      if (!topic) throw publicError('topic-not-found', 404);
      return { ...studentTopicView(topic.payload), customCourseId: topic.courseId };
    },

    async getTeacherTopic(owner, topicId) {
      const topic = await repository.topics.findReadyOwnedByTopicId(owner.id, topicId);
      if (!topic) throw publicError('topic-not-found', 404);
      return topic;
    },

    async resumePendingJobs() {
      const jobs = await repository.jobs.listClaimable();
      for (const job of jobs) scheduleJob(job.id);
      return jobs.length;
    },
  });
}

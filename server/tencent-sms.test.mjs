import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTencentSmsSender,
  createTencentTc3Headers,
  maskPhone,
  normalizeMainlandPhone,
} from './tencent-sms.mjs';

const TIMESTAMP = 1_551_113_065;
const PAYLOAD = JSON.stringify({
  PhoneNumberSet: ['+8613800138000'],
  SmsSdkAppId: '1401167280',
  SignName: '小白验证码',
  TemplateId: '1234567',
  TemplateParamSet: ['123456', '10'],
  SessionContext: 'test',
});

test('mainland phone normalization accepts documented prefixes and rejects non-mainland input', () => {
  for (const value of [
    '13800138000',
    '8613800138000',
    '008613800138000',
    '+8613800138000',
    '  +8613800138000  ',
  ]) {
    assert.equal(normalizeMainlandPhone(value), '+8613800138000');
  }
  for (const value of ['+85291234567', '+8612800138000', '138-0013-8000', '', null]) {
    assert.equal(normalizeMainlandPhone(value), null);
  }
  assert.equal(maskPhone('+8613800138000'), '+86138****8000');
  assert.equal(maskPhone('+85291234567'), null);
});

test('TC3 SendSms headers match a stable signing vector', () => {
  const headers = createTencentTc3Headers({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRETEXAMPLE',
    payload: PAYLOAD,
    timestamp: TIMESTAMP,
    region: 'ap-guangzhou',
  });
  assert.equal(
    headers.Authorization,
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2019-02-25/sms/tc3_request, '
      + 'SignedHeaders=content-type;host;x-tc-action, '
      + 'Signature=730616838cfc9653af852649d4b21e64307080fe82ae2e3b177387465e200b32',
  );
  assert.equal(headers['X-TC-Action'], 'SendSms');
  assert.equal(headers['X-TC-Version'], '2021-01-11');
  assert.equal(headers['X-TC-Region'], 'ap-guangzhou');
  assert.equal(headers.Host, 'sms.tencentcloudapi.com');
});

test('Tencent SMS sender posts one E.164 target with SDKAppID 1401167280', async () => {
  let request;
  const sender = createTencentSmsSender({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRETEXAMPLE',
    sdkAppId: '1401167280',
    signName: '小白验证码',
    templateId: '1234567',
    now: () => TIMESTAMP * 1000,
    fetchImpl: async (url, init) => {
      request = { url: String(url), ...init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        Response: {
          SendStatusSet: [{ PhoneNumber: '+8613800138000', Code: 'Ok' }],
          RequestId: 'request-id',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.deepEqual(await sender({
    phone: '13800138000',
    code: '123456',
    purpose: 'login',
    expiresInMinutes: 10,
    idempotencyKey: 'test',
  }), { requestId: 'request-id' });
  assert.equal(request.url, 'https://sms.tencentcloudapi.com/');
  assert.deepEqual(request.body, JSON.parse(PAYLOAD));
  assert.match(request.headers.Authorization, /Signature=73061683/);
});

test('Tencent SMS sender fails closed on per-recipient provider errors', async () => {
  const sender = createTencentSmsSender({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRETEXAMPLE',
    sdkAppId: '1401167280',
    signName: '小白验证码',
    templateId: '1234567',
    fetchImpl: async () => new Response(JSON.stringify({
      Response: {
        SendStatusSet: [{ PhoneNumber: '+8613800138000', Code: 'FailedOperation.TemplateIncorrectOrUnapproved' }],
        RequestId: 'request-id',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(
    sender({
      phone: '+8613800138000',
      code: '123456',
      purpose: 'login',
      expiresInMinutes: 10,
      idempotencyKey: 'test',
    }),
    /tencent-sms-request-failed:FailedOperation\.TemplateIncorrectOrUnapproved/,
  );
});

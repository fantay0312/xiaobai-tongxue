export const AUDIT_TARGET_OPTIONS = [
  { value: 'user', label: '用户' },
  { value: 'user-restriction', label: '用户限制' },
  { value: 'subscription-plan', label: '套餐' },
  { value: 'entitlement', label: '权益' },
  { value: 'feature', label: '功能门禁' },
  { value: 'subscription', label: '用户订阅' },
  { value: 'cdk-campaign', label: 'CDK 活动' },
  { value: 'admin-account', label: '管理席位' },
  { value: 'admin-invitation', label: '管理邀请' },
  { value: 'admin-role', label: '角色' },
] as const

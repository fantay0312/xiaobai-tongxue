import {
  pageInput,
  pathParts,
  permission,
  requireReason,
  safeInvitation,
  safeOperator,
} from './http.mjs';

const PREFIX = '/api/admin/v1';

export async function handleAdminTeamRoute(context) {
  const {
    req, pathname, url, principal, postgres, service, send, body, mutate,
  } = context;
  const parts = pathParts(pathname, PREFIX);

  if (parts.join('/') === 'team/permissions' && req.method === 'GET') {
    permission(principal, 'team.read');
    const items = (await postgres.adminRbac.listPermissions()).map((item) => ({
      id: item.id,
      key: item.permissionKey,
      name: item.name,
      description: item.description,
    }));
    send(200, { items, total: items.length, page: 1, pageSize: items.length });
    return true;
  }

  if (parts.join('/') === 'team/roles' && req.method === 'GET') {
    permission(principal, 'team.read');
    const items = await postgres.adminRbac.listRoles();
    send(200, { items, total: items.length, page: 1, pageSize: items.length });
    return true;
  }

  if (parts.join('/') === 'team/roles' && req.method === 'POST') {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'admin.role.create', targetType: 'admin-role',
      details: { reason },
    }, () => postgres.withTransaction((tx) => tx.adminRbac.createRole({
      ...input,
      createdBy: principal.account.id,
    })));
    send(201, result);
    return true;
  }

  if (parts[0] === 'team' && parts[1] === 'roles'
      && parts.length === 3 && req.method === 'PATCH') {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'admin.role.update', targetType: 'admin-role', targetId: parts[2],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.adminRbac.updateRole(parts[2], input),
    ));
    send(200, result);
    return true;
  }

  if (parts.join('/') === 'team/operators' && req.method === 'GET') {
    permission(principal, 'team.read');
    const items = (await postgres.adminRbac.listOperators()).map(safeOperator);
    send(200, { items, total: items.length, page: 1, pageSize: items.length });
    return true;
  }

  if (parts[0] === 'team' && parts[1] === 'operators' && parts[3] === 'status'
      && parts.length === 4 && req.method === 'POST') {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'admin.operator.status', targetType: 'admin-account', targetId: parts[2],
      details: {
        status: input.status,
        reason,
      },
    }, () => postgres.withTransaction(
      (tx) => tx.adminAuth.setStatus(parts[2], input.status),
    ));
    send(200, safeOperator(result));
    return true;
  }

  if (parts[0] === 'team' && parts[1] === 'operators' && parts[3] === 'roles'
      && parts.length === 4 && req.method === 'POST') {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const input = await body();
    const reason = requireReason(input.reason);
    const target = await postgres.adminAuth.findAccountById(parts[2]);
    if (!target || target.isOwner) throw new Error('owner-protected-or-not-found');
    await mutate({
      action: 'admin.operator.roles', targetType: 'admin-account', targetId: parts[2],
      details: {
        roleCount: Array.isArray(input.roleIds) ? input.roleIds.length : 0,
        reason,
      },
    }, () => postgres.withTransaction(async (tx) => {
      await tx.adminRbac.assignRoles(parts[2], input.roleIds ?? [], principal.account.id);
      await tx.adminAuth.revokeAccountSessions(parts[2]);
    }));
    send(200, { ok: true });
    return true;
  }

  if (parts.join('/') === 'team/invitations' && req.method === 'GET') {
    permission(principal, 'team.read');
    const items = (await postgres.adminRbac.listInvitations()).map(safeInvitation);
    send(200, { items, total: items.length, page: 1, pageSize: items.length });
    return true;
  }

  if (parts.join('/') === 'team/invitations' && req.method === 'POST') {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'admin.invitation.create', targetType: 'admin-account',
      details: {
        roleCount: Array.isArray(input.roleIds) ? input.roleIds.length : 0,
        reason,
      },
    }, () => service.inviteOperator(principal, input));
    send(201, {
      invitation: safeInvitation(result.invitation),
      operator: safeOperator(result.account),
    });
    return true;
  }

  if (parts[0] === 'team' && parts[1] === 'invitations' && parts[3] === 'resend'
      && parts.length === 4 && req.method === 'POST') {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'admin.invitation.resend', targetType: 'admin-invitation', targetId: parts[2],
      details: { reason },
    }, () => service.resendInvitation(principal, parts[2]));
    send(200, safeInvitation(result));
    return true;
  }

  if (parts[0] === 'audit' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'audit.read');
    const result = await postgres.adminRbac.listAudit({
      ...pageInput(url),
      action: url.searchParams.get('action'),
      targetType: url.searchParams.get('targetType'),
      actor: url.searchParams.get('actor'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });
    send(200, result);
    return true;
  }

  return false;
}

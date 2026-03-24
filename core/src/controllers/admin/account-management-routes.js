const { prepareAccountUpsertPayload } = require('../account-upsert-payload');

function getAccountEntries(snapshot) {
    return Array.isArray(snapshot && snapshot.accounts) ? snapshot.accounts : [];
}

function allocateNextAccountId(snapshot) {
    const accounts = getAccountEntries(snapshot);
    const maxId = accounts.reduce((max, account) => {
        const numericId = Number.parseInt(account && account.id, 10);
        return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
    }, 0);
    const snapshotNextId = Number.parseInt(snapshot && snapshot.nextId, 10);
    const nextId = Number.isFinite(snapshotNextId) && snapshotNextId > maxId
        ? snapshotNextId
        : maxId + 1;
    return String(Math.max(nextId, 1));
}

function getDuplicateIdentityRefs(body) {
    const source = (body && typeof body === 'object') ? body : {};
    return Array.from(new Set(
        [source.openId, source.uin, source.qq]
            .map(value => String(value || '').trim())
            .filter(Boolean)
    ));
}

function findDuplicateAccountByIdentity(snapshot, options = {}) {
    const identityRefs = Array.isArray(options.identityRefs)
        ? options.identityRefs.map(value => String(value || '').trim()).filter(Boolean)
        : [String(options.identityRef || '').trim()].filter(Boolean);
    const platform = String(options.platform || '').trim();
    const excludeId = String(options.excludeId || '').trim();
    if (!identityRefs.length || !platform) return null;

    return getAccountEntries(snapshot).find((account) => {
        if (!account) return false;
        const accountId = String((account && account.id) || '').trim();
        if (excludeId && accountId === excludeId) return false;
        const accountPlatform = String((account && account.platform) || 'qq').trim() || 'qq';
        if (accountPlatform !== platform) return false;
        const accountRefs = [
            account.openId,
            account.uin,
            account.qq,
        ]
            .map(value => String(value || '').trim())
            .filter(Boolean);
        return identityRefs.some(ref => accountRefs.includes(ref));
    }) || null;
}

function hasFreshLoginCredential(body) {
    const loginType = String((body && body.loginType) || '').trim().toLowerCase();
    if (loginType !== 'qr' && loginType !== 'manual') {
        return false;
    }
    return !!String((body && body.code) || '').trim() || !!String((body && body.authTicket) || '').trim();
}

function normalizeCodeCaptureSource(value) {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return 'captured_payload';
    if (source === 'qr_rebind' || source === 'manual_capture' || source === 'captured_payload' || source === 'qr_login') {
        return source;
    }
    return 'captured_payload';
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function extractCodeFromText(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const queryMatch = raw.match(/[?&]code=([^&]+)/i);
    if (queryMatch && queryMatch[1]) {
        try {
            return decodeURIComponent(queryMatch[1]).trim();
        } catch {
            return String(queryMatch[1] || '').trim();
        }
    }
    const directMatch = raw.match(/\b([A-Za-z0-9_-]{16,256})\b/);
    return directMatch ? String(directMatch[1] || '').trim() : '';
}

function pickFirstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function normalizeCodeCapturePayload(body = {}) {
    const rawPayload = body.rawPayload !== undefined ? body.rawPayload : (body.payload !== undefined ? body.payload : body.text);
    const rawText = typeof rawPayload === 'string' ? rawPayload.trim() : '';
    const parsedObject = rawPayload && typeof rawPayload === 'object'
        ? rawPayload
        : (rawText ? tryParseJson(rawText) : null);
    const source = (parsedObject && typeof parsedObject === 'object') ? parsedObject : {};

    const platform = String(
        pickFirstNonEmpty(body.platform, source.platform, source.loginType === 'qq' ? 'qq' : '')
        || 'qq'
    ).trim() || 'qq';
    const code = pickFirstNonEmpty(body.code, source.code, extractCodeFromText(rawText));
    const authTicket = pickFirstNonEmpty(body.authTicket, source.authTicket, source.auth_ticket, source.ticket);
    const openId = pickFirstNonEmpty(body.openId, body.open_id, source.openId, source.open_id, source.openid);
    const uin = pickFirstNonEmpty(body.uin, body.qq, source.uin, source.qq, source.userUin, source.user_uin);
    const nickname = pickFirstNonEmpty(body.nickname, body.nick, source.nickname, source.nick, source.name);
    const avatar = pickFirstNonEmpty(body.avatar, source.avatar, source.avatarUrl, source.avatar_url);
    const accountId = pickFirstNonEmpty(body.accountId, body.id, source.accountId, source.account_id);

    return {
        accountId,
        platform,
        uin,
        qq: platform === 'qq' ? uin : '',
        openId,
        code,
        authTicket,
        nickname,
        avatar,
        name: pickFirstNonEmpty(body.name, source.name, nickname, uin, openId, '补码账号'),
        source: normalizeCodeCaptureSource(body.source || source.source),
        rawPayload: parsedObject && typeof parsedObject === 'object' ? parsedObject : rawText,
    };
}

function resolveCodeCaptureTarget(snapshot, payload) {
    const accounts = getAccountEntries(snapshot);
    const explicitId = String(payload.accountId || '').trim();
    if (explicitId) {
        const account = accounts.find(item => String(item?.id || '').trim() === explicitId) || null;
        return {
            action: account ? 'update_existing' : 'create_new',
            matchedAccount: account,
            matchedBy: account ? 'accountId' : 'none',
        };
    }

    if (payload.openId) {
        const byOpenId = accounts.find(item => String(item?.openId || '').trim() === String(payload.openId || '').trim()) || null;
        if (byOpenId) {
            return {
                action: 'update_existing',
                matchedAccount: byOpenId,
                matchedBy: 'openId',
            };
        }
    }

    const identityRef = String(payload.uin || payload.qq || '').trim();
    if (identityRef) {
        const byIdentity = accounts.find((item) => {
            const refs = [item?.uin, item?.qq]
                .map(value => String(value || '').trim())
                .filter(Boolean);
            return refs.includes(identityRef);
        }) || null;
        if (byIdentity) {
            return {
                action: 'update_existing',
                matchedAccount: byIdentity,
                matchedBy: 'uin',
            };
        }
    }

    return {
        action: 'create_new',
        matchedAccount: null,
        matchedBy: 'none',
    };
}

function registerAccountManagementRoutes({
    app,
    accountOwnershipRequired,
    getAccountsSnapshot,
    getAccountList,
    resolveAccId,
    findAccountByRef,
    addOrUpdateAccount,
    deleteAccount,
    getProvider,
    store,
    consoleRef,
    adminOperationLogService,
}) {
    app.post('/api/account/remark', accountOwnershipRequired, async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
            const accountList = await getAccountList();
            const target = findAccountByRef(accountList, rawRef);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }

            const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
            if (!remark) {
                return res.status(400).json({ ok: false, error: 'Missing remark' });
            }

            const accountId = String(target.id);
            const data = await addOrUpdateAccount({ id: accountId, name: remark });
            const provider = getProvider();
            if (provider && typeof provider.setRuntimeAccountName === 'function') {
                await provider.setRuntimeAccountName(accountId, remark);
            }
            if (provider && provider.addAccountLog) {
                provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/accounts', async (req, res) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const isCreateRequest = !body.id;
            let createSnapshot = null;
            const shouldStartAfterSave = hasFreshLoginCredential(body);

            if (isCreateRequest) {
                createSnapshot = await getAccountsSnapshot({ force: true });
            }

            const duplicateIdentityRefs = getDuplicateIdentityRefs(body);
            const requestPlatform = String(body.platform || 'qq').trim() || 'qq';
            if (isCreateRequest && duplicateIdentityRefs.length > 0) {
                const duplicateEntry = findDuplicateAccountByIdentity(createSnapshot, {
                    platform: requestPlatform,
                    identityRefs: duplicateIdentityRefs,
                });
                if (duplicateEntry) {
                    consoleRef.log(`[API /api/accounts] 拦截重复创建: 标识 ${duplicateIdentityRefs.join('/')} 已存在，转为更新 (ID: ${duplicateEntry.id})`);
                    body.id = duplicateEntry.id;
                    if (!body.name || body.name === '扫码账号' || duplicateIdentityRefs.includes(String(body.name || '').trim())) {
                        body.name = duplicateEntry.name;
                    }
                }
            }

            const provider = getProvider();
            const isUpdate = !!body.id;
            const resolvedUpdateId = isUpdate ? await resolveAccId(body.id) : '';
            let payload = isUpdate ? { ...body, id: resolvedUpdateId || String(body.id) } : { ...body };
            let existingAccount = null;
            if (isUpdate) {
                const allAccounts = await getAccountsSnapshot();
                existingAccount = getAccountEntries(allAccounts).find(a => String(a.id) === String(payload.id)) || null;
            }
            let wasRunning = false;
            if (isUpdate && provider.isAccountRunning) {
                wasRunning = await provider.isAccountRunning(payload.id);
            }

            if (!isUpdate && req.currentUser && req.currentUser.maxAccounts > 0) {
                const allAccounts = createSnapshot || await getAccountsSnapshot({ force: true });
                const userAccounts = getAccountEntries(allAccounts).filter(a => a.username === req.currentUser.username);
                if (userAccounts.length >= req.currentUser.maxAccounts) {
                    return res.status(400).json({ ok: false, error: `体验卡用户最多绑定 ${req.currentUser.maxAccounts} 个账号` });
                }
            }

            if (isUpdate && req.currentUser && req.currentUser.role !== 'admin') {
                if (!existingAccount || existingAccount.username !== req.currentUser.username) {
                    return res.status(403).json({ ok: false, error: '无权修改此账号' });
                }
                payload.username = req.currentUser.username;
            }

            const prepared = prepareAccountUpsertPayload(payload, {
                existingAccount,
                isUpdate,
            });
            payload = prepared.payload;
            if (prepared.error) {
                return res.status(400).json({ ok: false, error: prepared.error });
            }

            if (!isUpdate && req.currentUser) {
                payload.username = req.currentUser.username;
            }
            if (String(payload.code || '').trim() || String(payload.authTicket || '').trim()) {
                const now = Date.now();
                payload.lastValidCodeAt = now;
                payload.lastCodeSource = String(payload.lastCodeSource || (payload.loginType === 'qr' ? 'qr_login' : 'manual_capture')).trim();
                payload.lastCodeCaptureAt = now;
                payload.lastCodeCaptureBy = String(req.currentUser?.username || payload.lastCodeCaptureBy || '').trim();
            }
            if (shouldStartAfterSave) {
                payload.wsError = null;
            }
            if (!isUpdate) {
                const freshSnapshot = createSnapshot || await getAccountsSnapshot({ force: true });
                payload.id = allocateNextAccountId(freshSnapshot);
                payload.__createIfMissing = true;
            }

            if (isUpdate) {
                const payloadIdentityRefs = getDuplicateIdentityRefs(payload);
                if (payloadIdentityRefs.length > 0 && payload.platform) {
                    const identitySnapshot = await getAccountsSnapshot({ force: true });
                    const duplicateEntry = findDuplicateAccountByIdentity(identitySnapshot, {
                        platform: payload.platform,
                        identityRefs: payloadIdentityRefs,
                        excludeId: payload.id,
                    });
                    if (duplicateEntry) {
                        if (req.currentUser && req.currentUser.role !== 'admin') {
                            const duplicateOwner = String(duplicateEntry.username || '').trim();
                            if (duplicateOwner && duplicateOwner !== req.currentUser.username) {
                                return res.status(409).json({ ok: false, error: `该账号已被用户 ${duplicateOwner} 绑定，无法覆盖` });
                            }
                        }

                        const previousId = String(payload.id || '').trim();
                        payload.id = String(duplicateEntry.id || '').trim();
                        existingAccount = duplicateEntry;
                        if (!payload.name || payload.name === '扫码账号' || payloadIdentityRefs.includes(String(payload.name || '').trim())) {
                            payload.name = duplicateEntry.name || payload.name;
                        }
                        if (provider.isAccountRunning) {
                            wasRunning = await provider.isAccountRunning(payload.id);
                        } else {
                            wasRunning = false;
                        }
                        consoleRef.log(`[API /api/accounts] 检测到同平台重复标识 ${payloadIdentityRefs.join('/')}，更新目标从 ${previousId || '-'} 切换到 ${payload.id}`);
                    }
                }
            }

            const data = await addOrUpdateAccount(payload);
            const savedAccountId = isUpdate
                ? String((data && data.touchedAccountId) || payload.id || '')
                : String((data && data.touchedAccountId) || payload.id || (data.accounts[data.accounts.length - 1] || {}).id || '');
            const savedAccount = savedAccountId
                ? (getAccountEntries(data).find(account => String(account && account.id) === savedAccountId) || null)
                : null;

            if (savedAccountId && typeof store.persistAccountsNow === 'function') {
                try {
                    await store.persistAccountsNow(savedAccountId, { strict: true });
                } catch (persistErr) {
                    if (typeof store.getAccountsFresh === 'function') {
                        await store.getAccountsFresh({ force: true }).catch(() => { });
                    }
                    throw persistErr;
                }
            }

            if (provider.addAccountLog) {
                const accountId = savedAccountId;
                const accountName = payload.name || '';
                provider.addAccountLog(
                    isUpdate ? 'update' : 'add',
                    isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
                    accountId,
                    accountName
                );
            }

            if (!isUpdate) {
                const newAcc = savedAccount || data.accounts[data.accounts.length - 1];
                if (newAcc) await provider.startAccount(newAcc.id);
            } else if (wasRunning) {
                await provider.restartAccount(savedAccountId || payload.id);
            } else if (shouldStartAfterSave && savedAccountId) {
                await provider.startAccount(savedAccountId);
            }

            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/accounts/code-capture/preview', async (req, res) => {
        try {
            if (req.currentUser?.role !== 'admin') {
                return res.status(403).json({ ok: false, error: '仅管理员可使用补码预览' });
            }
            const payload = normalizeCodeCapturePayload((req.body && typeof req.body === 'object') ? req.body : {});
            if (!payload.code && !payload.authTicket) {
                return res.status(400).json({ ok: false, error: '预览失败：抓包内容中未识别到可用 code / ticket' });
            }
            const snapshot = await getAccountsSnapshot({ force: true });
            const target = resolveCodeCaptureTarget(snapshot, payload);
            res.json({
                ok: true,
                data: {
                    ...target,
                    payload,
                },
            });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/accounts/code-capture/commit', async (req, res) => {
        try {
            if (req.currentUser?.role !== 'admin') {
                return res.status(403).json({ ok: false, error: '仅管理员可使用补码提交' });
            }

            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const payload = normalizeCodeCapturePayload(body);
            if (!payload.code && !payload.authTicket) {
                return res.status(400).json({ ok: false, error: '提交失败：抓包内容中未识别到可用 code / ticket' });
            }

            const snapshot = await getAccountsSnapshot({ force: true });
            const preview = resolveCodeCaptureTarget(snapshot, payload);
            const provider = getProvider();
            const accountId = preview.matchedAccount ? String(preview.matchedAccount.id || '').trim() : '';
            const wasRunning = accountId && provider?.isAccountRunning
                ? await provider.isAccountRunning(accountId)
                : false;
            const now = Date.now();
            const ownerUsername = req.currentUser?.role === 'admin'
                ? String(body.ownerUsername || preview.matchedAccount?.username || req.currentUser.username || '').trim()
                : String(req.currentUser?.username || '').trim();
            const savePayload = {
                id: accountId || undefined,
                name: String(body.name || preview.matchedAccount?.name || payload.name || '').trim() || `补码账号${payload.uin || payload.openId || ''}`,
                nick: payload.nickname || preview.matchedAccount?.nick || '',
                platform: payload.platform,
                uin: payload.uin,
                qq: payload.qq,
                openId: payload.openId,
                code: payload.code,
                authTicket: payload.authTicket,
                avatar: payload.avatar || preview.matchedAccount?.avatar || '',
                username: ownerUsername || preview.matchedAccount?.username || '',
                loginType: 'manual',
                lastValidCodeAt: now,
                lastCodeSource: payload.source,
                lastCodeCaptureAt: now,
                lastCodeCaptureBy: String(req.currentUser?.username || '').trim(),
            };
            if (!savePayload.id) {
                savePayload.__createIfMissing = true;
            }

            const prepared = prepareAccountUpsertPayload(savePayload, {
                existingAccount: preview.matchedAccount,
                isUpdate: !!savePayload.id,
            });
            if (prepared.error) {
                return res.status(400).json({ ok: false, error: prepared.error });
            }

            const data = await addOrUpdateAccount(prepared.payload);
            const savedAccountId = String((data && data.touchedAccountId) || prepared.payload.id || '').trim();
            if (savedAccountId && typeof store.persistAccountsNow === 'function') {
                await store.persistAccountsNow(savedAccountId, { strict: true });
            }

            if (savedAccountId && wasRunning && provider && typeof provider.restartAccount === 'function') {
                await provider.restartAccount(savedAccountId);
            } else if (savedAccountId && body.startAfterSave === true && provider && typeof provider.startAccount === 'function') {
                await provider.startAccount(savedAccountId);
            }

            if (adminOperationLogService && typeof adminOperationLogService.createAdminOperationLog === 'function') {
                await adminOperationLogService.createAdminOperationLog({
                    actorUsername: req.currentUser?.username,
                    scope: 'accounts',
                    actionLabel: preview.matchedAccount ? '补码重绑账号' : '抓包补码创建账号',
                    status: 'success',
                    totalCount: 1,
                    successCount: 1,
                    affectedNames: [String(prepared.payload.name || savedAccountId || '').trim()],
                    detailLines: [
                        `目标账号: ${savedAccountId || '新建中'}`,
                        `匹配方式: ${preview.matchedBy}`,
                        `来源: ${payload.source}`,
                    ],
                });
            }

            res.json({
                ok: true,
                data: {
                    preview,
                    payload: prepared.payload,
                    savedAccountId,
                },
            });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.delete('/api/accounts/:id', accountOwnershipRequired, async (req, res) => {
        try {
            const accountList = await getAccountList();
            const target = findAccountByRef(accountList, req.params.id);
            if (!target || !target.id) {
                return res.status(404).json({ ok: false, error: 'Account not found' });
            }

            const resolvedId = await resolveAccId(target.id) || String(target.id || '');
            const provider = getProvider();
            await provider.stopAccount(resolvedId);
            const data = deleteAccount(resolvedId);
            if (provider.addAccountLog) {
                provider.addAccountLog('delete', `删除账号: ${(target && target.name) || req.params.id}`, resolvedId, target ? target.name : '');
            }
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
}

module.exports = {
    registerAccountManagementRoutes,
};

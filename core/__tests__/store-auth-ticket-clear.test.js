const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const storeModulePath = require.resolve('../src/models/store');
const runtimePathsModulePath = require.resolve('../src/config/runtime-paths');
const systemSettingsModulePath = require.resolve('../src/services/system-settings');
const mysqlDbModulePath = require.resolve('../src/services/mysql-db');

function mockModule(modulePath, exports) {
    const previous = require.cache[modulePath];
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports,
    };

    return () => {
        if (previous) require.cache[modulePath] = previous;
        else delete require.cache[modulePath];
    };
}

function createRuntimePathsMock(rootDir) {
    const dataDir = path.join(rootDir, 'data');
    const logDir = path.join(rootDir, 'logs');
    return {
        getDataFile(filename) {
            fs.mkdirSync(dataDir, { recursive: true });
            return path.join(dataDir, filename);
        },
        ensureDataDir() {
            fs.mkdirSync(dataDir, { recursive: true });
            return dataDir;
        },
        ensureLogDir() {
            fs.mkdirSync(logDir, { recursive: true });
            return logDir;
        },
    };
}

function mapInsertParamsByColumn(sql, params) {
    const match = String(sql).match(/insert into accounts\s*\(([^)]+)\)\s*values/i);
    assert.ok(match, 'expected INSERT INTO accounts column list');
    const columns = match[1].split(',').map(column => column.trim());
    return Object.fromEntries(columns.map((column, index) => [column, params[index]]));
}

test('store persists explicit empty authTicket for manual qq code updates', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'store-auth-ticket-clear-'));
    const recordedQueries = [];

    const restoreRuntimePaths = mockModule(runtimePathsModulePath, createRuntimePathsMock(tempRoot));
    const restoreSystemSettings = mockModule(systemSettingsModulePath, {
        SYSTEM_SETTING_KEYS: {
            GLOBAL_CONFIG: 'global_config',
        },
        async getSystemSettings() {
            return {};
        },
        async setSystemSettings() {},
    });
    const restoreMysql = mockModule(mysqlDbModulePath, {
        isMysqlInitialized() {
            return true;
        },
        getPool() {
            return {
                async query(sql, params = []) {
                    recordedQueries.push([String(sql), params]);
                    if (String(sql).includes('SELECT * FROM accounts')) {
                        return [[{
                            id: '1004',
                            uin: '416409364',
                            nick: '旧昵称',
                            name: '账号1004',
                            platform: 'qq',
                            running: 0,
                            code: 'old-qr-code',
                            username: 'alice',
                            avatar: '',
                            last_login_at: null,
                            auth_data: JSON.stringify({
                                uin: '416409364',
                                qq: '416409364',
                                code: 'old-qr-code',
                                authTicket: 'stale-ticket-123',
                                runtimeSnapshot: {},
                            }),
                            created_at: new Date('2026-03-01T00:00:00.000Z'),
                            updated_at: new Date('2026-03-09T00:00:00.000Z'),
                        }]];
                    }
                    return [[]];
                },
            };
        },
        transaction: async (handler) => handler({ query: async () => [[]] }),
    });

    try {
        delete require.cache[storeModulePath];
        const store = require(storeModulePath);

        await store.getAccountsFresh({ force: true });
        recordedQueries.length = 0;

        store.addOrUpdateAccount({
            id: '1004',
            code: 'manual-fresh-code',
            authTicket: '',
        });
        await store.persistAccountsNow('1004', { strict: true });

        const upsertEntry = recordedQueries.find(([sql]) => sql.includes('INSERT INTO accounts'));
        assert.ok(upsertEntry, 'expected INSERT INTO accounts upsert query');
        const persistedValues = mapInsertParamsByColumn(upsertEntry[0], upsertEntry[1]);
        assert.equal(persistedValues.code, 'manual-fresh-code');

        const authData = JSON.parse(persistedValues.auth_data);
        assert.equal(authData.code, 'manual-fresh-code');
        assert.equal(authData.authTicket, '');
    } finally {
        delete require.cache[storeModulePath];
        restoreRuntimePaths();
        restoreSystemSettings();
        restoreMysql();
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

function initMasterRuntimeDispatcher({
    currentRole,
    getIO,
    initDispatcher,
    logger,
}) {
    if (currentRole !== 'master') {
        return null;
    }

    const io = typeof getIO === 'function' ? getIO() : null;
    if (!io) {
        if (logger && typeof logger.warn === 'function') {
            logger.warn('master dispatcher skipped: Admin Socket.IO 未就绪');
        }
        return null;
    }

    const dispatcher = initDispatcher(io);
    if (logger && typeof logger.info === 'function') {
        logger.info('master dispatcher initialized');
    }
    return dispatcher;
}

function disposeMasterRuntimeDispatcher({
    currentRole,
    disposeDispatcher,
    logger,
}) {
    if (currentRole !== 'master') {
        return null;
    }

    if (typeof disposeDispatcher === 'function') {
        disposeDispatcher();
        if (logger && typeof logger.info === 'function') {
            logger.info('master dispatcher disposed');
        }
    }

    return null;
}

module.exports = {
    initMasterRuntimeDispatcher,
    disposeMasterRuntimeDispatcher,
};

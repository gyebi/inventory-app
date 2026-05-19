import { getState, setState } from "../state.js";
import { createAppError, ERROR_FLAGS, toUserMessage } from "../utils/errorUtils.js";

const SALE_SYNC_PENDING = "pending";
const SALE_SYNC_SYNCED = "synced";
const SALE_SYNC_FAILED = "failed";

const getDefaultSyncMeta = () => ({
  syncStatus: SALE_SYNC_PENDING,
  syncedAt: null,
  retryCount: 0,
  lastSyncError: null,
  lastSyncAttemptAt: null
});

const normalizeSaleSyncState = (sale) => {
  return {
    ...getDefaultSyncMeta(),
    ...sale
  };
};

const getSalesSyncEndpoint = (state) => {
  return state.settings?.salesSyncEndpoint || null;
};

const markSaleSyncState = (saleId, updates) => {
  const state = getState();
  const sale = state.sales.find((entry) => entry.id === saleId);

  if (!sale) {
    return null;
  }

  Object.assign(sale, updates);
  setState(state);

  return sale;
};

const syncSaleToCloud = async (sale, endpoint) => {
  if (!endpoint) {
    throw createAppError("Sales sync is not configured. Add the sync endpoint before retrying.", {
      code: "sync/missing-endpoint",
      source: ERROR_FLAGS.SOURCE_SYNC
    });
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(sale)
  });

  if (!response.ok) {
    throw createAppError("Cloud sales sync failed. Retry once the connection or endpoint is healthy.", {
      code: `sync/http-${response.status}`,
      source: ERROR_FLAGS.SOURCE_SYNC,
      retryable: response.status >= 500
    });
  }

  return response;
};

export const ensureSalesSyncMetadata = () => {
  const state = getState();
  let changed = false;

  state.sales = (Array.isArray(state.sales) ? state.sales : []).map((sale) => {
    const normalized = normalizeSaleSyncState(sale);

    if (
      sale.syncStatus !== normalized.syncStatus ||
      sale.syncedAt !== normalized.syncedAt ||
      sale.retryCount !== normalized.retryCount ||
      sale.lastSyncError !== normalized.lastSyncError ||
      sale.lastSyncAttemptAt !== normalized.lastSyncAttemptAt
    ) {
      changed = true;
    }

    return normalized;
  });

  if (changed) {
    setState(state);
  }
};

export const buildSaleSyncMetadata = () => {
  return getDefaultSyncMeta();
};

export const attemptSaleSync = async (saleId) => {
  const state = getState();
  const sale = state.sales.find((entry) => entry.id === saleId);

  if (!sale) {
    return null;
  }

  const endpoint = getSalesSyncEndpoint(state);

  if (!endpoint) {
    return sale;
  }

  const nextRetryCount = (sale.retryCount || 0) + 1;
  const attemptTime = new Date().toISOString();

  markSaleSyncState(saleId, {
    lastSyncAttemptAt: attemptTime,
    retryCount: nextRetryCount,
    lastSyncError: null
  });

  try {
    await syncSaleToCloud(sale, endpoint);

    return markSaleSyncState(saleId, {
      syncStatus: SALE_SYNC_SYNCED,
      syncedAt: new Date().toISOString(),
      lastSyncError: null
    });
  } catch (error) {
    return markSaleSyncState(saleId, {
      syncStatus: SALE_SYNC_FAILED,
      lastSyncError: toUserMessage(error, "Unable to sync sale.")
    });
  }
};

export const queueSaleSync = (saleId) => {
  Promise.resolve()
    .then(() => attemptSaleSync(saleId))
    .catch(() => {});
};

export const retryPendingSalesSync = async () => {
  const state = getState();
  const pendingSales = (Array.isArray(state.sales) ? state.sales : []).filter(
    (sale) => sale.syncStatus !== SALE_SYNC_SYNCED
  );

  for (const sale of pendingSales) {
    await attemptSaleSync(sale.id);
  }
};

export const getSaleSyncStatus = {
  pending: SALE_SYNC_PENDING,
  synced: SALE_SYNC_SYNCED,
  failed: SALE_SYNC_FAILED
};

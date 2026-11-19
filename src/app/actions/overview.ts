'use server';

import { read, cleanQuery, toId } from '@/lib/actionResult';
import { listFlags } from '@/modules/overview/server/flags';
import { billingAgeing, listOverview, listOverviewFacet, orderSummary, overviewStats } from '@/modules/overview/server/query';

export async function listOverviewAction(query: unknown) {
  return read(() => listOverview(cleanQuery(query)));
}

export async function listOverviewFacetAction(key: unknown, query: unknown) {
  return read(() => listOverviewFacet(String(key), cleanQuery(query)));
}

export async function overviewStatsAction() {
  return read(() => overviewStats());
}

export async function listFlagsAction() {
  return read(() => listFlags());
}

export async function orderSummaryAction(orderId: unknown) {
  return read(() => orderSummary(toId(orderId, 'order')));
}

export async function billingAgeingAction(orderId?: unknown) {
  return read(() => billingAgeing(orderId === undefined || orderId === null || orderId === '' ? undefined : toId(orderId, 'order')));
}

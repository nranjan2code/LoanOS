import { searchCersaiCharges } from "@loanos/core";

export async function routeCersaiSearch({ method, path, url, res, store, sendJson }) {
  if (method !== "GET" || path !== "/cersai/search") return false;
  const state = await store.load();
  const assetDescription = url.searchParams.get("asset") ?? "";
  sendJson(res, 200, { assetDescription, ...searchCersaiCharges(assetDescription, state) });
  return true;
}

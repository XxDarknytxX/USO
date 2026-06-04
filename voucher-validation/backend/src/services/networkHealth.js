// src/services/networkHealth.js
// Fetch one project's live health from Ruijie Cloud — shared by the per-project
// health endpoint and the background overview collector so they stay identical.

export async function fetchProjectHealth(ruijie, project) {
  const opts = { groupId: project.ruijie_group_id, tenantId: project.ruijie_tenant_id };
  const { cloudSync, devices = [], error, reason } = await ruijie.getDevices(opts);

  let clientTotal = 0;
  if (cloudSync) {
    const { total, byDeviceSn } = await ruijie.getClients(opts);
    clientTotal = total;
    for (const d of devices) {
      const k = String(d.sn || '').toUpperCase();
      if (byDeviceSn[k] != null) d.clientCount = byDeviceSn[k];
    }
  }

  const gateways = devices.filter((d) => d.type === 'gateway');
  const aps = devices.filter((d) => d.type === 'ap');
  const switches = devices.filter((d) => d.type === 'switch');
  const others = devices.filter((d) => d.type === 'other');
  const onlineCount = (arr) => arr.filter((d) => d.online).length;
  const onlineGw = gateways.find((g) => g.online);

  const summary = {
    totalDevices: devices.length,
    onlineDevices: onlineCount(devices),
    offlineDevices: devices.length - onlineCount(devices),
    apTotal: aps.length,
    apOnline: onlineCount(aps),
    gatewayTotal: gateways.length,
    gatewayOnline: onlineCount(gateways),
    switchTotal: switches.length,
    switchOnline: onlineCount(switches),
    clients: clientTotal || aps.reduce((s, a) => s + (a.clientCount || 0), 0),
  };

  // Internet from the gateway's real WAN port (2.6.4); fall back to gateway-online.
  let internet = {
    up: gateways.length > 0 ? gateways.some((g) => g.online) : null,
    publicIp: onlineGw?.publicIp || null,
  };
  let usageBytes = null;
  if (cloudSync && onlineGw) {
    const wan = await ruijie.getGatewayInterfaces(onlineGw.sn);
    if (wan && wan.internetUp !== null && wan.internetUp !== undefined) {
      internet = { up: wan.internetUp, publicIp: wan.wanIp || onlineGw.publicIp || null };
      onlineGw.publicIp = wan.wanIp || onlineGw.publicIp;
      onlineGw.wanUp = wan.internetUp;
    }
    const usage = await ruijie.getGatewayUsage(onlineGw.sn, project.ruijie_group_id);
    usageBytes = usage?.bytes ?? null;
  }

  return {
    cloudSync: !!cloudSync,
    reason: cloudSync ? null : (reason || error || 'Device data unavailable'),
    devices,
    summary,
    internet,
    usageBytes,
    topology: { internet, gateways, aps, switches, others },
  };
}

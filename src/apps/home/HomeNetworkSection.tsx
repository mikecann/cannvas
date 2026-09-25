import { Download, Network, Upload, Wifi } from "lucide-react";
import { useMemo } from "react";
import { formatRate, type NetworkStatus } from "../../lib/homeAssistant";

export function HomeNetworkSection({ network }: { network: NetworkStatus }) {
  const clients = useMemo(() => [...(network.clients ?? [])]
    .sort((left, right) => right.downloadBps + right.uploadBps - left.downloadBps - left.uploadBps)
    .slice(0, 8), [network.clients]);

  return (
    <section className="home-network-section">
      <div className="home-section-title">
        <div><span>UniFi network</span><h2>Connected now</h2></div>
        <strong>{network.connected ? `${network.online ?? 0} online` : "Offline"}</strong>
      </div>
      {network.connected ? (
        <>
          <div className="home-network-summary">
            <article><span><Network /></span><div><strong>{network.online ?? 0}</strong><small>Devices online</small></div></article>
            <article><span className="download"><Download /></span><div><strong>{formatRate(network.downloadBps)}</strong><small>Internet download</small></div></article>
            <article><span className="upload"><Upload /></span><div><strong>{formatRate(network.uploadBps)}</strong><small>Internet upload</small></div></article>
          </div>
          <div className="home-network-clients">
            {clients.map((client, index) => (
              // Several phones can share a name and have no IP, so add the position.
              <article key={`${client.name}-${client.ip ?? client.network}-${index}`}>
                <span className="home-network-client-icon"><Wifi /></span>
                <div className="home-network-client-name"><strong>{client.name}</strong><small>{client.ip ?? "No IP"} · {client.isWired ? "Wired" : client.network}</small></div>
                <div className="home-network-rate download"><Download /><strong>{formatRate(client.downloadBps)}</strong></div>
                <div className="home-network-rate upload"><Upload /><strong>{formatRate(client.uploadBps)}</strong></div>
              </article>
            ))}
          </div>
        </>
      ) : <p className="home-section-empty">UniFi is connected to Home Assistant, but the controller is not responding right now.</p>}
    </section>
  );
}

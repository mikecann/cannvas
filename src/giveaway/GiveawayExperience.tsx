import { useQuery } from "convex/react";
import { Gift, ImageOff, LoaderCircle, PackageOpen, RefreshCw } from "lucide-react";
import { api } from "../../convex/_generated/api";

function ItemPhotos({ title, photoUrls }: { title: string; photoUrls: string[] }) {
  if (photoUrls.length === 0) {
    return <div className="giveaway-photo-placeholder"><ImageOff /><span>No photo yet</span></div>;
  }

  return (
    <div className="giveaway-photos" aria-label={`${title} photos`}>
      {photoUrls.map((url, index) => (
        <img key={url} src={url} alt={index === 0 ? title : `${title}, view ${index + 1}`} loading="lazy" />
      ))}
      {photoUrls.length > 1 && <span className="giveaway-photo-count">{photoUrls.length} photos</span>}
    </div>
  );
}

export function GiveawayExperience() {
  const items = useQuery(api.inventory.publicGiveaway);

  return (
    <main className="giveaway-page">
      <header className="giveaway-header">
        <div className="giveaway-mark" aria-hidden="true"><Gift /></div>
        <div>
          <h1>Giveaway</h1>
          <p>Useful things from Mike’s place that are looking for a new home.</p>
        </div>
      </header>

      {items === undefined ? (
        <div className="giveaway-state"><LoaderCircle className="giveaway-spinner" /><p>Checking what’s available…</p></div>
      ) : items.length === 0 ? (
        <div className="giveaway-state"><PackageOpen /><h2>Nothing available right now</h2><p>Pop back later. This page updates whenever something moves into the giveaway pile.</p></div>
      ) : (
        <>
          <div className="giveaway-summary">
            <strong>{items.length} item{items.length === 1 ? "" : "s"} available</strong>
            <span><RefreshCw />Updated automatically</span>
          </div>
          <section className="giveaway-grid" aria-label="Available giveaway items">
            {items.map((item) => (
              <article className="giveaway-card" key={item._id}>
                <ItemPhotos title={item.title} photoUrls={item.photoUrls} />
                <div className="giveaway-card-copy">
                  <div className="giveaway-labels">
                    <span>{item.category}</span>
                    {item.boxOnly && <span className="giveaway-box-only"><PackageOpen />Box only</span>}
                  </div>
                  <h2>{item.title}</h2>
                  {item.description && <p>{item.description}</p>}
                  <dl>
                    <div><dt>Condition</dt><dd>{item.condition}</dd></div>
                    {item.quantity > 1 && <div><dt>Quantity</dt><dd>{item.quantity}</dd></div>}
                  </dl>
                  {item.enrichmentStatus !== "ready" && <small>Details are still being checked.</small>}
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      <footer>If you know Mike and would like something, send him a message.</footer>
    </main>
  );
}

import { useAuthActions } from "@convex-dev/auth/react";
import {
  Box,
  Camera,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  LogOut,
  MapPin,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type InventoryStatus = "active" | "disposed" | "donated" | "sold" | "lost";
type InventoryItemSummary = {
  _id: Id<"inventoryItems">;
  title: string;
  description: string;
  category: string;
  tags: string[];
  currentLocationName: string;
  enrichmentStatus: string;
  photoUrl: string | null;
  quantity: number;
};

type CapturePhoto = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "uploaded" | "failed";
  storageId?: Id<"_storage">;
};

const MAX_PHOTOS_PER_UPLOAD = 8;
const INVENTORY_PAGE_SIZE = 18;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^\[CONVEX[^\]]*\]\s*/, "") : String(error);
}

function AuthScreen() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn("password", { email: email.trim(), password, flow });
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="inventory-auth">
      <div className="inventory-auth-mark"><Box /></div>
      <h1>Cannvas Inventory</h1>
      <p>Everything you own, and exactly where you put it.</p>
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete={flow === "signUp" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
        {error && <div className="inventory-error"><CircleAlert />{error}</div>}
        <button className="inventory-primary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : null}
          {flow === "signIn" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button className="inventory-text-button" onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}>
        {flow === "signIn" ? "First time? Create an account" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}

function AccessGate() {
  const status = useQuery(api.inventory.accessStatus);
  const { signOut } = useAuthActions();

  if (status === undefined) return <LoadingScreen />;
  if (status.hasAccess) return <InventoryBrowser />;

  return (
    <main className="inventory-auth">
      <div className="inventory-auth-mark"><ShieldCheck /></div>
      <h1>Access needed</h1>
      <p>This account has not been granted access to the Cannvas household inventory.</p>
      <button className="inventory-text-button" onClick={() => void signOut()}>Sign out</button>
    </main>
  );
}

function LoadingScreen() {
  return <main className="inventory-loading"><LoaderCircle className="spin" /><span>Opening inventory…</span></main>;
}

async function uploadFiles(
  files: File[],
  generateUploadUrl: () => Promise<string>,
) {
  return await Promise.all(files.map(async (file) => {
    const uploadUrl = await generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type || "image/jpeg" },
      body: file,
    });
    if (!response.ok) throw new Error("A photo could not be uploaded. Please try again.");
    return (await response.json() as { storageId: Id<"_storage"> }).storageId;
  }));
}

function CaptureSheet({ onClose }: { onClose: () => void }) {
  const suggestions = useQuery(api.inventory.locationSuggestions) ?? [];
  const generateUploadUrlMutation = useMutation(api.inventory.generateUploadUrl);
  const createItem = useMutation(api.inventory.create);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const [photos, setPhotos] = useState<CapturePhoto[]>([]);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    inputRef.current?.click();
  }, []);

  const uploadPhoto = async (photo: CapturePhoto) => {
    try {
      const [storageId] = await uploadFiles([photo.file], () => generateUploadUrlMutation({}));
      setPhotos((current) => current.map((candidate) =>
        candidate.id === photo.id ? { ...candidate, status: "uploaded", storageId } : candidate,
      ));
    } catch (caught) {
      setPhotos((current) => current.map((candidate) =>
        candidate.id === photo.id ? { ...candidate, status: "failed" } : candidate,
      ));
      setError(getErrorMessage(caught));
    }
  };

  const addFiles = (incoming: File[]) => {
    const accepted = incoming.slice(0, Math.max(0, MAX_PHOTOS_PER_UPLOAD - photos.length));
    if (!accepted.length) return;
    setError("");
    setSuccess("");
    const additions = accepted.map((file): CapturePhoto => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        status: "uploading",
      };
    });
    setPhotos((current) => [...current, ...additions]);
    additions.forEach((photo) => void uploadPhoto(photo));
  };

  const removePhoto = (photo: CapturePhoto) => {
    URL.revokeObjectURL(photo.previewUrl);
    previewUrls.current.delete(photo.previewUrl);
    setPhotos((current) => current.filter((candidate) => candidate.id !== photo.id));
  };

  const retryUploads = () => {
    const failed = photos.filter((photo) => photo.status === "failed");
    setError("");
    setPhotos((current) => current.map((photo) =>
      photo.status === "failed" ? { ...photo, status: "uploading" } : photo,
    ));
    failed.forEach((photo) => void uploadPhoto({ ...photo, status: "uploading" }));
  };

  const clearPhotos = () => {
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.previewUrl);
      previewUrls.current.delete(photo.previewUrl);
    });
    setPhotos([]);
  };

  const save = async (keepGoing: boolean) => {
    const storageIds = photos.flatMap((photo) => photo.storageId ? [photo.storageId] : []);
    if (storageIds.length !== photos.length || !location.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createItem({ storageIds, locationName: location.trim() });
      clearPhotos();
      if (keepGoing) {
        setSuccess("Item saved and queued for AI. Ready for the next one.");
        setBusy(false);
      } else {
        onClose();
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
      setBusy(false);
    }
  };

  const isUploading = photos.some((photo) => photo.status === "uploading");
  const hasFailedUploads = photos.some((photo) => photo.status === "failed");
  const canSave = photos.length > 0 && !isUploading && !hasFailedUploads && Boolean(location.trim());

  return (
    <div className="inventory-sheet-backdrop" role="presentation">
      <section className="inventory-sheet" role="dialog" aria-modal="true" aria-label="Add an inventory item">
        <header><div><h2>Add an item</h2><p>Photograph labels, connectors and each useful angle.</p></div><button className="inventory-icon-button" onClick={onClose}><X /></button></header>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => {
          // FileList is live. Copy it before resetting the input or Safari empties it
          // before React gets to the state update.
          const incoming = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          addFiles(incoming);
        }} />
        <div className="inventory-photo-strip">
          {photos.map((photo, index) => (
            <div className="inventory-photo-preview" key={photo.id}>
              <img src={photo.previewUrl} alt={`Item angle ${index + 1}`} />
              <span className={`inventory-photo-upload-state ${photo.status}`}>
                {photo.status === "uploading" ? <LoaderCircle className="spin" /> : photo.status === "uploaded" ? <CircleCheck /> : <CircleAlert />}
              </span>
              <button aria-label={`Remove angle ${index + 1}`} onClick={() => removePhoto(photo)}><X /></button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS_PER_UPLOAD && <button className="inventory-add-photo" onClick={() => inputRef.current?.click()}><Camera /><span>{photos.length ? "Another angle" : success ? "Photograph next item" : "Take photo"}</span></button>}
        </div>
        <label className="inventory-location-field">
          <span>Where will it live?</span>
          <div><MapPin /><input value={location} list="inventory-locations" placeholder="Attic, box A" onChange={(event) => setLocation(event.target.value)} /></div>
        </label>
        <datalist id="inventory-locations">{suggestions.map((suggestion) => <option key={suggestion._id} value={suggestion.name} />)}</datalist>
        {suggestions.length > 0 && <div className="inventory-location-chips">{suggestions.slice(0, 6).map((suggestion) => <button key={suggestion._id} onClick={() => setLocation(suggestion.name)}>{suggestion.name}</button>)}</div>}
        {success && <div className="inventory-success" aria-live="polite"><CircleCheck />{success}</div>}
        {error && <div className="inventory-error"><CircleAlert />{error}</div>}
        {hasFailedUploads ? (
          <button className="inventory-save-button" disabled={busy} onClick={retryUploads}>Retry uploads</button>
        ) : (
          <div className="inventory-capture-actions">
            <button className="inventory-save-button" disabled={busy || !canSave} onClick={() => void save(true)}>
              {busy || isUploading ? <LoaderCircle className="spin" /> : <Sparkles />}
              {busy ? "Saving item…" : isUploading ? "Uploading photos…" : "Add item & next"}
            </button>
            <button className="inventory-finish-button" disabled={busy || !canSave} onClick={() => void save(false)}>Add item & finish</button>
          </div>
        )}
      </section>
    </div>
  );
}

function InventoryCard({ item, onOpen }: {
  item: InventoryItemSummary;
  onOpen: () => void;
}) {
  const needsReview = item.tags.some((tag) => tag.toLocaleLowerCase("en-AU") === "needs review");
  return (
    <button className="inventory-card" onClick={onOpen}>
      <div className="inventory-card-photo">
        {item.photoUrl ? <img src={item.photoUrl} alt="" /> : <PackageOpen />}
        {item.enrichmentStatus !== "ready" && <span className={`inventory-ai-state ${item.enrichmentStatus}`}><Sparkles />{item.enrichmentStatus === "failed" ? "Needs details" : "Identifying"}</span>}
        {item.enrichmentStatus === "ready" && needsReview && <span className="inventory-ai-state review"><CircleAlert />Needs review</span>}
      </div>
      <div className="inventory-card-copy">
        <span className="inventory-category">{item.category}</span>
        <h2>{item.title}</h2>
        {item.description && <p>{item.description}</p>}
        <div className="inventory-card-location"><MapPin />{item.currentLocationName}{item.quantity > 1 && <b>×{item.quantity}</b>}</div>
      </div>
    </button>
  );
}

function DetailSheet({ itemId, onClose }: { itemId: Id<"inventoryItems">; onClose: () => void }) {
  const detail = useQuery(api.inventory.get, { itemId });
  const suggestions = useQuery(api.inventory.locationSuggestions) ?? [];
  const updateDetails = useMutation(api.inventory.updateDetails);
  const move = useMutation(api.inventory.move);
  const setStatus = useMutation(api.inventory.setStatus);
  const generateUploadUrlMutation = useMutation(api.inventory.generateUploadUrl);
  const addPhotos = useMutation(api.inventory.addPhotos);
  const photoInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [location, setLocation] = useState("");

  if (detail === undefined) return <div className="inventory-detail-backdrop"><LoadingScreen /></div>;
  if (!detail) return null;
  const { item, photos, events } = detail;

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await updateDetails({
        itemId,
        title: String(data.get("title") ?? ""),
        description: String(data.get("description") ?? ""),
        category: String(data.get("category") ?? ""),
        tags: String(data.get("tags") ?? "").split(","),
        condition: String(data.get("condition") ?? ""),
        quantity: Number(data.get("quantity") ?? 1),
        attributes: item.attributes,
      });
      setEditing(false);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async () => {
    if (!location.trim()) return;
    setBusy(true);
    try {
      await move({ itemId, locationName: location.trim() });
      setLocation("");
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const uploadMore = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const storageIds = await uploadFiles(
        files.slice(0, MAX_PHOTOS_PER_UPLOAD),
        () => generateUploadUrlMutation({}),
      );
      await addPhotos({ itemId, storageIds, rerunEnrichment: true });
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inventory-detail-backdrop">
      <article className="inventory-detail">
        <header className="inventory-detail-header"><button className="inventory-icon-button" onClick={onClose}><ChevronLeft /></button><button className="inventory-icon-button" onClick={() => setEditing(!editing)}><Pencil /></button></header>
        <div className="inventory-detail-photos">
          {photos.map((photo) => photo.url && <img key={photo._id} src={photo.url} alt="Inventory item" />)}
          <button onClick={() => photoInput.current?.click()}><Camera /><span>Add photos</span></button>
          <input ref={photoInput} className="visually-hidden" type="file" accept="image/*" capture="environment" multiple onChange={(event) => {
            const incoming = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void uploadMore(incoming);
          }} />
        </div>
        {editing ? (
          <form className="inventory-edit-form" onSubmit={saveDetails}>
            <label>Title<input name="title" defaultValue={item.title} /></label>
            <label>Description<textarea name="description" defaultValue={item.description} rows={4} /></label>
            <div className="inventory-form-pair"><label>Category<input name="category" defaultValue={item.category} /></label><label>Quantity<input name="quantity" type="number" min="1" defaultValue={item.quantity} /></label></div>
            <label>Condition<input name="condition" defaultValue={item.condition} /></label>
            <label>Tags<input name="tags" defaultValue={item.tags.join(", ")} /></label>
            <button className="inventory-primary" disabled={busy}>Save details</button>
          </form>
        ) : (
          <div className="inventory-detail-copy">
            <span className="inventory-category">{item.category}</span>
            <h1>{item.title}</h1>
            <p>{item.description || "No description yet."}</p>
            <div className="inventory-detail-meta"><span><MapPin />{item.currentLocationName}</span><span>{item.condition}</span><span>Qty {item.quantity}</span></div>
            {item.tags.length > 0 && <div className="inventory-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
            {item.tags.some((tag) => tag.toLocaleLowerCase("en-AU") === "needs review") && <div className="inventory-review-note"><CircleAlert />The AI was not confident about every detail. Check the title, photos and attributes when you have a moment.</div>}
            {item.attributes.length > 0 && <dl className="inventory-attributes">{item.attributes.map(({ label, value }) => <div key={`${label}-${value}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
            {item.enrichmentStatus === "failed" && <div className="inventory-error"><CircleAlert />{item.enrichmentError ?? "AI identification failed."}</div>}
            {item.aiSources.length > 0 && <section className="inventory-sources"><h2>Identification sources</h2>{item.aiSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</section>}
          </div>
        )}
        <section className="inventory-move"><h2>Move item</h2><div><input value={location} list="detail-locations" placeholder="Enter a new location" onChange={(event) => setLocation(event.target.value)} /><button disabled={!location.trim() || busy} onClick={() => void moveItem()}>Move</button></div><datalist id="detail-locations">{suggestions.map((suggestion) => <option key={suggestion._id} value={suggestion.name} />)}</datalist></section>
        <section className="inventory-lifecycle"><h2>Item status</h2><select value={item.status} disabled={busy} onChange={(event) => void setStatus({ itemId, status: event.target.value as InventoryStatus })}><option value="active">In inventory</option><option value="disposed">Thrown away</option><option value="donated">Donated</option><option value="sold">Sold</option><option value="lost">Lost</option></select></section>
        <section className="inventory-history"><h2>History</h2>{events.map((event) => <div key={event._id}><span>{event.type.replaceAll("_", " ")}</span><p>{event.fromLocationName && event.toLocationName ? `${event.fromLocationName} → ${event.toLocationName}` : event.note}</p><time>{new Date(event.occurredAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</time></div>)}</section>
        {error && <div className="inventory-error inventory-sticky-error"><CircleAlert />{error}</div>}
      </article>
    </div>
  );
}

function InventoryBrowser() {
  const { signOut } = useAuthActions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InventoryStatus>("active");
  const [capturing, setCapturing] = useState(false);
  const [selected, setSelected] = useState<Id<"inventoryItems"> | null>(null);
  const reviewFilterActive = search.trim().toLocaleLowerCase("en-AU") === "needs review";
  const sentinel = useRef<HTMLDivElement>(null);
  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.inventory.list,
    { search: search.trim() || undefined, status },
    { initialNumItems: INVENTORY_PAGE_SIZE },
  );

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && pageStatus === "CanLoadMore") {
        loadMore(INVENTORY_PAGE_SIZE);
      }
    }, { rootMargin: "300px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, pageStatus]);

  return (
    <main className="inventory-root">
      <header className="inventory-topbar">
        <div><div className="inventory-logo"><Box /></div><h1>Inventory</h1></div>
        <button className="inventory-icon-button" onClick={() => void signOut()} aria-label="Sign out"><LogOut /></button>
      </header>
      <div className="inventory-search"><Search /><input type="search" value={search} placeholder="Search everything" onChange={(event) => setSearch(event.target.value)} />{search && <button onClick={() => setSearch("")}><X /></button>}</div>
      <div className="inventory-status-tabs">
        <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>In inventory</button>
        <button className={reviewFilterActive ? "active" : ""} onClick={() => setSearch(reviewFilterActive ? "" : "needs review")}>Needs review</button>
        <button className={status !== "active" ? "active" : ""} onClick={() => setStatus(status === "active" ? "disposed" : status)}>Removed</button>
        {status !== "active" && <select value={status} onChange={(event) => setStatus(event.target.value as InventoryStatus)}><option value="disposed">Thrown away</option><option value="donated">Donated</option><option value="sold">Sold</option><option value="lost">Lost</option></select>}
      </div>
      <section className="inventory-grid">
        {results.map((item) => <InventoryCard key={item._id} item={item} onOpen={() => setSelected(item._id)} />)}
      </section>
      {results.length === 0 && pageStatus !== "LoadingFirstPage" && <div className="inventory-empty"><PackageOpen /><h2>{search ? "Nothing matched" : "Your inventory is empty"}</h2><p>{search ? "Try a different word or location." : "Photograph the first thing you want to keep track of."}</p></div>}
      {(pageStatus === "LoadingFirstPage" || pageStatus === "LoadingMore") && <div className="inventory-page-loading"><LoaderCircle className="spin" /></div>}
      <div ref={sentinel} />
      <button className="inventory-fab" onClick={() => setCapturing(true)}><Plus /><span>Add item</span></button>
      {capturing && <CaptureSheet onClose={() => setCapturing(false)} />}
      {selected && <DetailSheet itemId={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

export function InventoryExperience() {
  return (
    <>
      <AuthLoading><LoadingScreen /></AuthLoading>
      <Unauthenticated><AuthScreen /></Unauthenticated>
      <Authenticated><AccessGate /></Authenticated>
    </>
  );
}

import { House } from "lucide-react";
import { useState } from "react";
import { DialogBackdrop } from "../../components/DialogBackdrop";
import { errorText, readJsonResponse } from "../../lib/http";

type HomeSettingsDialogProps = {
  initialUrl: string;
  configured: boolean;
  onClose: () => void;
  onConnected: () => Promise<void>;
};

// The URL field starts from the saved address when the dialog opens and then
// belongs to the person typing. Status refreshes never overwrite it.
export function HomeSettingsDialog({ initialUrl, configured, onClose, onConnected }: HomeSettingsDialogProps) {
  const [url, setUrl] = useState(initialUrl);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const edited = url !== initialUrl || token !== "";

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || !token.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/home-assistant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), token: token.trim() }),
      });
      await readJsonResponse(response, "Could not connect Home Assistant");
      setToken("");
      onClose();
      await onConnected();
    } catch (requestError) {
      setError(errorText(requestError, "Could not connect Home Assistant"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogBackdrop className="home-settings-backdrop" onDismiss={edited || saving ? undefined : onClose}>
      <form className="dialog-card home-settings-card" onSubmit={(event) => void save(event)}>
        <div className="dialog-symbol info"><House /></div>
        <h2>Connect Home Assistant</h2>
        <p>The token is stored only on this mirror. In Home Assistant, open your profile and create a Long-Lived Access Token.</p>
        <label><span>Home Assistant address</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} autoComplete="off" inputMode="url" /></label>
        <label><span>Long-lived access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder={configured ? "Enter a new token to reconnect" : "Paste token here"} /></label>
        {error && <div className="home-settings-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="button primary" type="submit" disabled={!url.trim() || !token.trim() || saving}>{saving ? "Connecting…" : "Connect"}</button>
        </div>
      </form>
    </DialogBackdrop>
  );
}

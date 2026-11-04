// Saving files: a native "Save as" dialog in Electron (via the allowlisted IPC call) or a normal download in the browser.
import { isElectron } from '../core/http.js';
import { toast } from './cards.js';

// Saves text (utf8) or binary (base64) content under a suggested name; returns true if saved.
export async function saveOrDownload({
  defaultName,
  content,
  encoding = 'utf8',
  mime = 'text/plain',
}) {
  if (isElectron()) {
    const result = await window.api.saveFile({ defaultName, content, encoding });
    if (!result.ok) {
      toast(`Could not save the file: ${result.error}`);
      return false;
    }
    if (result.saved) toast(`Saved ${defaultName}.`);
    return result.saved;
  }
  const bytes =
    encoding === 'base64'
      ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(content);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = defaultName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Downloaded ${defaultName}.`);
  return true;
}

// Strips the "data:image/png;base64," prefix from a data URL.
export const dataUrlToBase64 = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

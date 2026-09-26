export const CLASSIFICATION_LABELS: Record<string, string> = {
  public: "Publiek",
  internal: "Intern",
  confidential: "Vertrouwelijk",
  restricted: "Strikt vertrouwelijk",
};

export const CLASSIFICATION_STYLES: Record<string, string> = {
  public: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  internal: "bg-sky-50 text-sky-700 ring-sky-200",
  confidential: "bg-amber-50 text-amber-800 ring-amber-200",
  restricted: "bg-rose-50 text-rose-700 ring-rose-200",
};

export const ROLE_LABELS: Record<string, string> = { owner: "Eigenaar", editor: "Bewerker", viewer: "Lezer" };

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

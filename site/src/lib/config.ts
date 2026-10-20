// Site-wide constants.
export const REPO_URL = "https://github.com/openformatdb/openformatdb";
export const SITE_NAME = "OpenFormatDB";
export const PITCH =
  "An open directory of file formats: how to recognise each one, which open tools read, write and convert it, and how far it is documented — so nobody, human or AI agent, redoes work that already exists.";

export const STATUS_LABEL: Record<string, string> = {
  unknown: "Unknown",
  "in-progress": "In progress",
  partial: "Partly documented",
  readable: "Readable",
  writable: "Writable",
};

export const STATUS_HELP: Record<string, string> = {
  unknown: "Listed; nothing is recorded about open software for it.",
  "in-progress": "Someone holds a live claim; no usable result yet.",
  partial: "Part of the structure is documented.",
  readable: "Open-source software reads it.",
  writable: "Open-source software reads and writes it.",
};

export const FIDELITY_LABEL: Record<string, string> = { lossless: "Lossless", partial: "Partial", lossy: "Lossy" };

export const LICENSES = { code: "AGPL-3.0-or-later", data: "CC BY-SA 4.0" };

export const displayName = (name: string, version?: string) => (version ? `${name} ${version}` : name);

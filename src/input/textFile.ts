export const ALLOWED_TEXT_EXTENSIONS = new Set(['.txt', '.md']);
export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

export const isTextFile = (name: string): boolean =>
  ALLOWED_TEXT_EXTENSIONS.has(extensionOf(name));

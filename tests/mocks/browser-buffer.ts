export const Buffer = {
  byteLength: (value: string) => new TextEncoder().encode(value).byteLength,
};

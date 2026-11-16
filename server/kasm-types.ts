export const kasmPermissions = [
  { id: 'audio', label: 'Autoplay session audio', features: ['autoplay'] },
  { id: 'clipboard', label: 'Clipboard access', features: ['clipboard-read', 'clipboard-write'] },
  { id: 'microphone', label: 'Microphone access', features: ['microphone'] },
  { id: 'camera', label: 'Camera access', features: ['camera'] },
] as const;

export type KasmPermission = (typeof kasmPermissions)[number]['id'];
export type KasmLaunch = { url: string; permissions?: KasmPermission[] };
export type KasmSettings = {
  url: string;
  enabled: boolean;
  permissions: KasmPermission[];
  source: 'dashboard' | 'environment' | 'default';
  hasEnvironment: boolean;
};

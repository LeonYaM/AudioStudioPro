import type { AudioStudioApi } from '../main/preload';

declare global {
  interface Window {
    audioStudio: AudioStudioApi;
  }
}

export {};

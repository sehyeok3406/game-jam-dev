import type { MultiplayerSettings } from './multiplayer.ts';
import type { HtmlResultChoice } from './preview.ts';
import type { DocumentResultChoice } from './document-output.ts';
export type GamejamRequest = {
  multiplayer?: MultiplayerSettings | null;
  canvasId?: string;
  sourceMode?: 'html' | 'html-compose';
  organize: boolean;
  implement: boolean;
  inputPaths: string[];
  x: number;
  y: number;
  htmlResult?: HtmlResultChoice;
  documentResult?: DocumentResultChoice;
  instructions: Record<'organize' | 'implement', string>;
  resultName: string;
};

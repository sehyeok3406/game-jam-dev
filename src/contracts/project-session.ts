/** Public process-local identity. Contains neither filesystem paths nor credentials. */
export type ProjectSessionRef = Readonly<{
  projectKey: string;
  sessionId: string;
  epoch: number;
}>;

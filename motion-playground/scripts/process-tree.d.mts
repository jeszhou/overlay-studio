/** Stop the given job and its descendants; throws if the operating system refuses. */
export function stopProcessTree(pid: number | undefined): Promise<void>;

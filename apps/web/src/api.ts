import type { LootEvent, LootFeedSnapshot } from '@torchlight-companion/domain';

const baseUrl = 'http://127.0.0.1:4777/api/v1';

export async function fetchLootRecent(): Promise<{ data: LootFeedSnapshot }> {
  const response = await fetch(`${baseUrl}/loot/recent`);
  if (!response.ok) throw new Error(`GET /loot/recent failed: ${response.status}`);
  return (await response.json()) as { data: LootFeedSnapshot };
}

export function subscribeToLootEvents(onEvent: (event: LootEvent) => void): () => void {
  const source = new EventSource(`${baseUrl}/loot/events`);
  source.addEventListener('message', (message) => {
    onEvent(JSON.parse(message.data) as LootEvent);
  });
  return () => source.close();
}

/** Fetch the overlay-goal share code from the local-agent (null if unset). */
export async function fetchGoalCode(): Promise<string | null> {
  const response = await fetch(`${baseUrl}/goal`);
  if (!response.ok) throw new Error(`GET /goal failed: ${response.status}`);
  const body = (await response.json()) as { data: { code: string | null } };
  return body.data.code;
}

/** Persist the overlay-goal share code on the local-agent (null clears it). */
export async function putGoalCode(code: string | null): Promise<void> {
  const response = await fetch(`${baseUrl}/goal`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (!response.ok) throw new Error(`PUT /goal failed: ${response.status}`);
}

/** Subscribe to goal changes broadcast by the local-agent. */
export function subscribeToGoal(onChange: (code: string | null) => void): () => void {
  const source = new EventSource(`${baseUrl}/goal/events`);
  source.addEventListener('message', (message) => {
    onChange((JSON.parse(message.data) as { code: string | null }).code);
  });
  return () => source.close();
}

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

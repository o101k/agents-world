export type EventKind =
  | 'world_created'
  | 'agent_arrived'
  | 'ate'
  | 'drank'
  | 'gathered'
  | 'fell_asleep'
  | 'woke_up'
  | 'collapsed'
  | 'need_critical'
  | 'died'
  | 'new_day'
  | 'decided'
  | 'said'
  | 'cap_reached'
  | 'observer'
  | 'crafted'
  | 'traded'
  | 'gave'
  | 'offer'
  | 'stole'
  | 'attacked'
  | 'fed'
  | 'taught'
  | 'partnered'
  | 'separated'
  | 'pregnant'
  | 'born'
  | 'named'
  | 'grew_up'
  | 'inherited'
  | 'built'
  | 'world_event'
  | 'fell_ill'
  | 'recovered'
  | 'tended'
  | 'reflected'
  | 'fire'
  | 'season';

/** A readable history entry. importance: 1 = routine … 5 = life-changing. */
export interface WorldEvent {
  id?: number;
  tick: number;
  kind: EventKind;
  actors: string[];
  text: string;
  importance: number;
}

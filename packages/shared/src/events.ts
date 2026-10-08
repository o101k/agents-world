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
  | 'limit_reached'
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
  | 'orphaned'
  | 'adopted'
  | 'grew_up'
  | 'inherited'
  | 'built'
  | 'world_event'
  | 'fell_ill'
  | 'recovered'
  | 'tended'
  | 'reflected'
  | 'fire'
  | 'season'
  | 'farmed'
  | 'quarried'
  | 'animals'
  | 'stall'
  | 'job'
  | 'meeting'
  | 'rule_passed'
  | 'treasury';

/** A readable history entry. importance: 1 = routine … 5 = life-changing. */
export interface WorldEvent {
  id?: number;
  tick: number;
  kind: EventKind;
  actors: string[];
  /**
   * Ids of the map objects it happened to or at (a house built or burnt, a bush picked, the
   * market traded at). An object's history is every event that names it here.
   */
  objects?: string[];
  text: string;
  importance: number;
}

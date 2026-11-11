// Stand-in block list used before the user picks their Spacebox GameSet folder, so the app can be tried right away.
// Only block ids, categories, sizes and rough made-up colours: no Spacebox textures or data are included. The colours are
// plain approximations, so previews are coloured cubes and the real look appears once the GameSet folder is picked.
import type { GameSet, RGB, SpaceboxBlock } from './gameset';

type Def = [id: string, name: string, color: RGB, extra?: Partial<SpaceboxBlock>];

const GROUPS: [category: string, defs: Def[]][] = [
  ['MetalBlocks', [
    ['aluminium_block_light', 'Aluminium Light Block', [200, 203, 208]],
    ['aluminium_block_medium', 'Aluminium Medium Block', [160, 164, 170]],
    ['aluminium_block_heavy', 'Aluminium Heavy Block', [118, 122, 130]],
    ['iron_block_light', 'Iron Light Block', [170, 150, 140]],
    ['iron_block_medium', 'Iron Medium Block', [130, 115, 108]],
    ['iron_block_heavy', 'Iron Heavy Block', [95, 85, 82]],
    ['titanium_block_light', 'Titanium Light Block', [170, 178, 190]],
    ['titanium_block_medium', 'Titanium Medium Block', [130, 140, 158]],
    ['titanium_block_heavy', 'Titanium Heavy Block', [95, 104, 125]],
  ]],
  ['Windows', [
    ['window', 'Window', [170, 215, 235], { transparent: true }],
    ['reinforced_window', 'Reinforced Window', [120, 170, 200], { transparent: true }],
    ['big_window', 'Big Window', [150, 200, 225], { transparent: true }],
  ]],
  ['Lights', [
    ['light_white', 'White Light', [255, 255, 255], { model: 'torch' }],
    ['light_yellow', 'Yellow Light', [255, 230, 90], { model: 'torch' }],
    ['light_orange', 'Orange Light', [255, 160, 60], { model: 'torch' }],
    ['light_red', 'Red Light', [240, 70, 70], { model: 'torch' }],
    ['light_pink', 'Pink Light', [255, 130, 190], { model: 'torch' }],
    ['light_green', 'Green Light', [80, 230, 110], { model: 'torch' }],
    ['light_cyan', 'Cyan Light', [80, 225, 235], { model: 'torch' }],
    ['light_blue', 'Blue Light', [80, 120, 255], { model: 'torch' }],
  ]],
  ['Resources', [
    ['light_rock', 'Light Rock', [140, 130, 125]],
    ['medium_rock', 'Medium Rock', [110, 102, 98]],
    ['heavy_rock', 'Heavy Rock', [80, 75, 74]],
    ['ice_rock', 'Ice Rock', [170, 205, 225]],
    ['dense_ice_rock', 'Dense Ice Rock', [140, 180, 210]],
    ['cobaltite_rock', 'Cobaltite Rock', [60, 90, 140]],
    ['iron_ore', 'Iron Ore', [150, 110, 90]],
    ['aluminium_ore', 'Aluminium Ore', [190, 190, 195]],
    ['titanium_ore', 'Titanium Ore', [110, 130, 160]],
    ['uranium_ore', 'Uranium Ore', [90, 200, 90]],
    ['thulium_ore', 'Thulium Ore', [220, 200, 70]],
    ['obscurium_ore', 'Obscurium Ore', [200, 80, 170]],
  ]],
  ['Crates', [
    ['basic_aluminium_crate', 'Basic Aluminium Crate', [155, 155, 155], { type: 'storage' }],
    ['basic_iron_crate', 'Basic Iron Crate', [5, 5, 5], { type: 'storage' }],
    ['basic_titanium_crate', 'Basic Titanium Crate', [155, 155, 155], { type: 'storage' }],
    ['safe', 'Armored Safe', [10, 10, 15], { type: 'storage' }],
  ]],
  ['Devices', [
    ['claim_beacon', 'Claim Beacon', [255, 215, 80], { type: 'claim' }],
    ['dna_reconstructor', 'DNA Reconstructor', [75, 85, 85], { type: 'dnareconstructor' }],
    ['gravity_generator', 'Gravity Generator', [75, 70, 80], { type: 'gravity' }],
    ['oxygen_generator', 'Oxygen Generator', [75, 95, 105], { type: 'oxygengenerator' }],
    ['radar', 'Radar', [230, 215, 0], { type: 'radar' }],
  ]],
  ['Doors', [
    ['aluminium_door', 'Aluminium Door', [155, 155, 155], { size: [2, 2, 1], type: 'door' }],
    ['iron_door', 'Iron Door', [85, 85, 85], { size: [2, 2, 1], type: 'door' }],
    ['titanium_door', 'Titanium Door', [65, 65, 135], { size: [2, 2, 1], type: 'door' }],
  ]],
  ['Explosives', [
    ['cobalt_bomb', 'Cobalt Bomb', [5, 5, 5], { type: 'explosive' }],
    ['uranium_bomb', 'Uranium Bomb', [5, 5, 5], { type: 'explosive' }],
  ]],
  ['Frames', [
    ['picture_frame_iron_1x1', 'Iron Picture Frame', [115, 125, 135], { type: 'frame' }],
    ['picture_frame_iron_2x1', 'Wide Iron Picture Frame', [115, 125, 135], { type: 'frame' }],
    ['picture_frame_iron_2x2', 'Large Iron Picture Frame', [115, 125, 135], { type: 'frame' }],
    ['picture_frame_plastic_1x1', 'Plastic Picture Frame', [220, 215, 205], { type: 'frame' }],
    ['picture_frame_plastic_2x1', 'Wide Plastic Picture Frame', [220, 215, 205], { type: 'frame' }],
    ['picture_frame_plastic_2x2', 'Large Plastic Picture Frame', [220, 215, 205], { type: 'frame' }],
  ]],
  ['Logistics', [
    ['item_pipe', 'Item Pipe', [90, 80, 70], { type: 'pipe' }],
    ['item_pipe_merger', 'Merging Item Pipe', [75, 75, 75], { type: 'pipe' }],
    ['item_pipe_straight', 'Straight Item Pipe', [75, 75, 75], { type: 'pipe' }],
  ]],
  ['Machines', [
    ['analyzer', 'Ore scanner', [230, 215, 0], { type: 'analyzer' }],
    ['basic_machine', 'Basic Machine', [95, 95, 95]],
    ['crafting_table', 'Crafting Table', [80, 80, 205], { type: 'craftingtable' }],
    ['crusher', 'Crusher', [215, 10, 10], { type: 'crusher' }],
    ['disassembler', 'Disassembler', [255, 0, 0], { type: 'disassembler' }],
    ['enhanced_crusher', 'Enhanced Crusher', [215, 10, 10], { type: 'crusher' }],
    ['enhanced_furnace', 'Enhanced Furnace', [90, 90, 90], { type: 'furnace' }],
    ['furnace', 'Furnace', [90, 90, 90], { type: 'furnace' }],
  ]],
  ['Other', [
    ['barrier', 'Barrier', [130, 65, 65], { type: 'invisible', transparent: true }],
    ['moritz', 'Moritz', [240, 195, 25]],
  ]],
  ['Power', [
    ['cable_block', 'Cable Block', [110, 105, 70], { type: 'cable' }],
    ['cobalt_power_block', 'Standard Cobalt Power Block', [215, 215, 10], { size: [1, 2, 1], type: 'generator' }],
    ['nuclear_power_block', 'Powerful Nuclear Power Block', [105, 105, 65], { size: [2, 3, 2], type: 'generator' }],
    ['powerful_cobalt_power_block', 'Powerful Cobalt Power Block', [105, 105, 70], { size: [1, 2, 1], type: 'generator' }],
    ['standard_nuclear_power_block', 'Standard Nuclear Power Block', [95, 95, 75], { size: [2, 2, 2], type: 'generator' }],
  ]],
  ['Ships/Cannons', [
    ['cannon_anticorvette', 'Anti-Corvette Gun', [155, 0, 155], { size: [2, 3, 1], type: 'cannon' }],
    ['cannon_antifrigate', 'Anti-Frigate Gun', [190, 0, 0], { size: [2, 4, 2], type: 'cannon' }],
    ['cannon_antipersonnel', 'Anti-Personnel Gun', [140, 120, 150], { type: 'cannon' }],
    ['cannon_heavy_assault', 'Heavy Assault Gun', [15, 160, 15], { size: [1, 2, 1], type: 'cannon' }],
    ['cannon_light_assault', 'Light Assault Gun', [75, 65, 200], { size: [1, 2, 1], type: 'cannon' }],
  ]],
  ['Ships/Control', [
    ['cannon_console', 'Cannon Console', [230, 215, 0], { type: 'shipconsole' }],
    ['ship_camera', 'Ship Camera', [80, 80, 80], { type: 'shipcamera' }],
    ['ship_console', 'Ship Console', [100, 95, 85], { type: 'shipconsole' }],
  ]],
  ['Ships/Thrusters', [
    ['thruster_ion', 'Standard Ion Thruster', [95, 95, 75], { size: [2, 2, 2], type: 'thruster' }],
    ['thruster_powerful', 'Powerful Hydrogen Thruster', [90, 90, 75], { size: [2, 1, 2], type: 'thruster' }],
    ['thruster_standard', 'Standard Hydrogen Thruster', [95, 95, 70], { size: [1, 2, 1], type: 'thruster' }],
    ['thruster_weak', 'Weak Hydrogen Thruster', [90, 85, 70], { type: 'thruster' }],
  ]],
  ['Signs', [
    ['sign_panel_wide', 'Info Panel', [60, 70, 80], { type: 'sign' }],
    ['sign_steel', 'Steel Sign', [150, 150, 160], { type: 'sign' }],
    ['sign_steel_wide', 'Wide Steel Sign', [150, 150, 160], { type: 'sign' }],
  ]],
];

export function fallbackGameSet(): GameSet {
  const blocks: SpaceboxBlock[] = [];
  for (const [category, defs] of GROUPS) {
    for (const [localId, name, color, extra] of defs) {
      blocks.push({
        id: `default:${localId}`, localId, name, category, size: [1, 1, 1], transparent: false,
        color, textures: {}, file: '', ...extra,
      });
    }
  }
  return {
    modId: 'default', modName: 'Demo block list', version: '0.1.5.1', blocks,
    byId: new Map(blocks.map((b) => [b.id, b])),
    categories: GROUPS.map(([c]) => c),
  };
}

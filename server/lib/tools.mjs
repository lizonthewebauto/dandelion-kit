// Every tool, in the order of TOOL_NAMES. server/index.mjs registers exactly these.
import { TOOL_NAMES } from '../../core/types.mjs';
import { tool as approve_post } from '../tools/approve_post.mjs';
import { tool as check_reel } from '../tools/check_reel.mjs';
import { tool as connect_dandelion } from '../tools/connect_dandelion.mjs';
import { tool as dandelion_status } from '../tools/dandelion_status.mjs';
import { tool as doctor } from '../tools/doctor.mjs';
import { tool as export_files } from '../tools/export.mjs';
import { tool as get_project } from '../tools/get_project.mjs';
import { tool as list_projects } from '../tools/list_projects.mjs';
import { tool as make_carousel } from '../tools/make_carousel.mjs';
import { tool as make_image } from '../tools/make_image.mjs';
import { tool as make_variants } from '../tools/make_variants.mjs';
import { tool as offer_post } from '../tools/offer_post.mjs';
import { tool as open_path } from '../tools/open_path.mjs';
import { tool as open_video } from '../tools/open_video.mjs';
import { tool as pick_look } from '../tools/pick_look.mjs';
import { tool as plan_shots } from '../tools/plan_shots.mjs';
import { tool as read_asset } from '../tools/read_asset.mjs';
import { tool as render_reel } from '../tools/render_reel.mjs';
import { tool as rough_cut } from '../tools/rough_cut.mjs';
import { tool as send_to_dandelion } from '../tools/send_to_dandelion.mjs';
import { tool as set_channel_copy } from '../tools/set_channel_copy.mjs';
import { tool as skip_post } from '../tools/skip_post.mjs';
import { tool as update_cut } from '../tools/update_cut.mjs';
import { tool as update_shot_plan } from '../tools/update_shot_plan.mjs';
import { tool as update_slides } from '../tools/update_slides.mjs';

const BY_NAME = {
  doctor,
  open_video,
  get_project,
  list_projects,
  rough_cut,
  update_cut,
  pick_look,
  plan_shots,
  update_shot_plan,
  render_reel,
  check_reel,
  make_variants,
  make_carousel,
  update_slides,
  make_image,
  export: export_files,
  offer_post,
  set_channel_copy,
  connect_dandelion,
  dandelion_status,
  send_to_dandelion,
  approve_post,
  skip_post,
  read_asset,
  open_path,
};

/** @type {readonly import('./kit.mjs').ToolDef[]} */
export const TOOLS = Object.freeze(TOOL_NAMES.map((name) => /** @type {import('./kit.mjs').ToolDef} */ (/** @type {any} */ (BY_NAME)[name])));

/** @param {string} name */
export function toolByName(name) {
  return TOOLS.find((t) => t.name === name);
}

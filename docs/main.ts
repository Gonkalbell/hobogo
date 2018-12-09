type Player = number;
type Board = Player[][];
interface Coord {
  x: number;
  y: number;
}

// ----------------------------------------------------------------------------

// the `wasm_bindgen` global is set to the exports of the Rust module. Override with wasm-bindgen --no-modules-global
declare var wasm_bindgen: any;

// we'll defer our execution until the wasm is ready to go
function wasm_loaded() {
  console.log(`wasm loaded`);
  start_game();
}

// here we tell bindgen the path to the wasm file so it can start
// initialization and return to us a promise when it's done
wasm_bindgen("./hobogo_bg.wasm")
  .then(wasm_loaded)
  .catch(console.error);

function player_to_wasm(player: Player) {
  return player === null ? -1 : player;
}

function board_to_wasm(board: Board) {
  const wasm_board = new Int8Array(board.length * board[0].length);
  let i = 0;
  for (const row of board) {
    for (const cell of row) {
      wasm_board[i++] = player_to_wasm(cell);
    }
  }
  return wasm_board;
}

function ai_move(board: Board, player: Player) {
  return wasm_bindgen.ai_move(board_to_wasm(board), player_to_wasm(player), num_players());
}

function game_over(board: Board) {
  return wasm_bindgen.game_over(board_to_wasm(board), num_players());
}

// ----------------------------------------------------------------------------

function player_name(player: Player): string {
  let name;
  if (player === 0) {
    name = "blue";
  } else if (player === 1) {
    name = "red";
  } else if (player === 2) {
    name = "green";
  } else if (player === 3) {
    name = "yellow";
  } else {
    name = `p${player}`;
  }

  if (player >= g_num_humans) {
    name += " (AI)";
  }

  return name;
}

function player_color(player: Player): string {
  if (player === null) {
    return "#AAAAAA";
  }

  if (player === 0) {
    return "#5577FF";
  } else if (player === 1) {
    return "#FF0000";
  } else if (player === 2) {
    return "#00FF00";
  } else {
     return "#DDDD00";
   }
}

// blendColors from https://stackoverflow.com/a/13542669
function blend_hex_colors(c0, c1, p) {
    const f = parseInt(c0.slice(1), 16);
    const t = parseInt(c1.slice(1), 16);
    const R1 = f >> 16;
    const G1 = f >> 8 & 0x00FF;
    const B1 = f & 0x0000FF;
    const R2 = t >> 16;
    const G2 = t >> 8 & 0x00FF;
    const B2 = t & 0x0000FF;
    return "#" + (0x1000000 + (Math.round((R2 - R1) * p) + R1) * 0x10000 +
                  (Math.round((G2 - G1) * p) + G1) * 0x100 +
                  (Math.round((B2 - B1) * p) + B1)).toString(16).slice(1);
}

function cell_color(board: Board, coord: Coord) {
  const claimer = claimed_by(board, coord);
  if (claimer !== null) {
    return player_color(claimer);
  }

  const is_human = g_current_player < g_num_humans;
  if (is_human && !is_valid_move(board, coord, g_current_player)) {
    // The current human can´t move here.
    return "#555555";
  }

  return "#999999"; // Free (at least for some).
}

function calc_cell_size(board: Board) {
  return 440 / board.length;
}

function hovered_cell(board: Board, mouse_pos: Coord) {
  const cell_size = calc_cell_size(board);
  for (let y = 0; y < board.length; ++y) {
    for (let x = 0; x < board[y].length; ++x) {
      const pad = 2;
      const left = x * cell_size + pad;
      const top = y * cell_size + pad;
      const right = (x + 1) * cell_size - pad;
      const bottom = (y + 1) * cell_size - pad;
      const is_hovering =
        left <= mouse_pos.x && mouse_pos.x <= right &&
        top <= mouse_pos.y && mouse_pos.y <= bottom;
      if (is_hovering) {
        return {x, y};
      }
    }
  }
  return null;
}

function column_name(x: number): string {
  return String.fromCharCode(x + 65);
}

function row_name(y: number): string {
  return `${y + 1}`;
}

// Chess name:
function coord_name(coord: Coord): string {
  return `${column_name(coord.x)}${row_name(coord.y)}`;
}

// From https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-on-html-canvas
function rounded_rect(ctx, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  return ctx;
}

function paint_board(canvas, board: Board, hovered: Coord) {

  if (hovered !== null) {
    board = make_move(board, hovered, g_current_player) || board; // PREVIEW!
  }

  const ctx = canvas.getContext("2d");
  ctx.font = "20px Palatino";
  ctx.fillStyle = "#111111";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cell_size = calc_cell_size(board);

  const PAINT_INFLUENCE_CONNECTIONS = false;
  for (let y = 0; y < board.length; ++y) {
    for (let x = 0; x < board[y].length; ++x) {
      if (board[y][x] === null && PAINT_INFLUENCE_CONNECTIONS) {
        for (let dy = -1; dy <= +1; ++dy) {
          for (let dx = -1; dx <= +1; ++dx) {
            if (dx === 0 && dy === 0) { continue; }
            const neighbor_coord = {x: x + dx, y: y + dy};
            const neightbor_val = board_at(board, neighbor_coord);
            if (neightbor_val !== null) {
              let color = player_color(neightbor_val);
              color += "80"; // Transparent

              ctx.beginPath();
              ctx.lineWidth = 4;
              ctx.strokeStyle = color;
              ctx.moveTo((x + 0.5) * cell_size, (y + 0.5) * cell_size);
              // const f = (dx * dy === 0) ? 0.45 : 0.38;
              // const f = 1.0;
              const f = 0.45 / Math.sqrt(dx * dx + dy * dy);
              ctx.lineTo((x + dx * f + 0.5) * cell_size, (y + dy * f + 0.5) * cell_size);
              ctx.stroke();
            }
          }
        }
      }
    }
  }

  for (let y = 0; y < board.length; ++y) {
    for (let x = 0; x < board[y].length; ++x) {
      const center_x = (x + 0.5) * cell_size;
      const center_y = (y + 0.5) * cell_size;

      ctx.fillStyle = cell_color(board, {x, y});

      if (board_at(board, {x, y}) === null) {
        const radius = 0.25 * cell_size;
        ctx.beginPath();
        ctx.arc(center_x, center_y, radius, 0, 2 * Math.PI, false);
        ctx.fill();
      } else {
        const hw = 0.42 * cell_size;
        const left = center_x - hw;
        const top = center_y - hw;
        const right = center_x + hw;
        const bottom = center_y + hw;
        rounded_rect(ctx, left, top, 2 * hw, 2 * hw, 0.45 * hw).fill();
      }

      const PAINT_INFLUENCE_CIRCLES = false;
      if (board[y][x] === null && PAINT_INFLUENCE_CIRCLES) {
        for (let dy = -1; dy <= +1; ++dy) {
          for (let dx = -1; dx <= +1; ++dx) {
            if (dx === 0 && dy === 0) { continue; }
            const neighbor_coord = {x: x + dx, y: y + dy};
            const neightbor_val = board_at(board, neighbor_coord);
            if (neightbor_val !== null) {
              let color = player_color(neightbor_val);
              color += "80"; // Transparent

              const f = 0.40 / Math.sqrt(dx * dx + dy * dy);
              const cx = (x + dx * f + 0.5) * cell_size;
              const cy = (y + dy * f + 0.5) * cell_size;

              const radius = 3;
              ctx.beginPath();
              ctx.arc(cx, cy, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = color;
              ctx.fill();
            }
          }
        }
      }
    }
  }

  // Columns: A, B, C, D, ...
  for (let x = 0; x < board[0].length; ++x) {
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText(`${column_name(x)}`, (x + 0.5) * cell_size, board.length * cell_size + 16);
    ctx.textAlign = "start";
  }

  // Rows: 1, 2, 3, ...
  for (let y = 0; y < board[0].length; ++y) {
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.fillText(`${row_name(y)}`, board[0].length * cell_size + 12, (y + 0.5) * cell_size + 8);
    ctx.textAlign = "start";
  }

  {
    const LINES_SPACING = 32;

    let y = board.length * cell_size + 64;
    if (game_over(board)) {
      ctx.fillStyle = "white";
      ctx.fillText(`GAME OVER`, 12, y);
    } else {
      ctx.fillStyle = player_color(g_current_player);
      ctx.fillText(`${player_name(g_current_player)} to play`, 12, y);
    }
    y += 1.5 * LINES_SPACING;

    ctx.fillStyle = "white";
    ctx.fillText(`Standings:`, 12, y);
    y += LINES_SPACING;

    const score = get_score(board);
    for (let pi = 0; pi < num_players(); ++pi) {
      ctx.fillStyle = player_color(pi);
      ctx.fillText(`${player_name(pi)}`, 12, y);
      ctx.textAlign = "end";
      ctx.fillText(`${score[pi]}`, 200, y);
      ctx.textAlign = "start";
      y += LINES_SPACING;
    }
    ctx.fillStyle = "white";
  }
}

function get_mouse_pos(canvas, evt): Coord {
  const rect = canvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
  };
}

const g_canvas = document.getElementById("hobo_canvas");

function array(n, value_maker) {
  const board = [];
  for (let i = 0; i < n; ++i) {
    board.push(value_maker(i));
  }
  return board;
}

function make_board(n: number): Board {
  return array(n, (_) => array(n, (__) => null));
}

function is_board_at(board: Board, coord: Coord): boolean {
  if (coord.x < 0 || board[0].length <= coord.x) { return false; }
  if (coord.y < 0 || board.length <= coord.y) { return false; }
  return true;
}

function board_at(board: Board, coord: Coord): Player | null {
  return is_board_at(board, coord) ? board[coord.y][coord.x] : null;
}

function influences_at(board: Board, coord: Coord): number[] {
  const influences = array(num_players(), (_) => 0);
  for (let dy = -1; dy <= +1; ++dy) {
    for (let dx = -1; dx <= +1; ++dx) {
      if (dx === 0 && dy === 0) { continue; }
      const neighbor_coord = {x: coord.x + dx, y: coord.y + dy};
      const neightbor_val = board_at(board, neighbor_coord);
      if (neightbor_val !== null) {
        influences[neightbor_val] += 1;
      }
    }
  }
  return influences;
}

// This piece of ground is by majority influenced by...
function claimed_by(board: Board, coord: Coord): Player | null {
  if (board[coord.y][coord.x] !== null) {
    return board[coord.y][coord.x];
  }

  const influences = influences_at(board, coord);
  for (let player = 0; player < num_players(); ++player) {
    let somebody_else_is_as_large = false;
    for (let other = 0; other < num_players(); ++other) {
      if (player !== other && influences[other] >= influences[player]) {
        somebody_else_is_as_large = true;
      }
    }
    if (!somebody_else_is_as_large) {
      return player;
    }
  }

  return null;
}

function get_score(board: Board): number[] {
  const score = array(num_players(), (_) => 0);

  for (let y = 0; y < board.length; ++y) {
    for (let x = 0; x < board[y].length; ++x) {
      const claimer = claimed_by(board, {x, y});
      if (claimer !== null) {
        score[claimer] += 1;
      }
    }
  }

  return score;
}

function is_valid_move(board: Board, coord: Coord, player: Player): boolean {
  if (coord === null) { return false; }
  if (coord.x < 0 || board[0].length <= coord.x) { return false; }
  if (coord.y < 0 || board.length <= coord.y) { return false; }
  if (board[coord.y][coord.x] !== null) { return false; }

  const influences = influences_at(board, coord);
  for (let i = 0; i < num_players(); ++i) {
    if (influences[i] > influences[player]) {
      return false;
    }
  }
  return true;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function make_move(board: Board, coord: Coord, player: Player): Board {
  const is_pass = (coord.x === -1 && coord.y === -1);
  if (is_pass) { return clone(board); }

  if (!is_valid_move(board, coord, player)) {
    return null;
  }

  board = clone(board);
  board[coord.y][coord.x] = player;

  return board;
}

let g_board_size = 7;
let g_board = make_board(g_board_size);
let g_current_player = 0;
let g_num_humans = 1;
let g_num_cpus = 1;

function num_players() {
  return g_num_humans + g_num_cpus;
}

function start_game() {
  g_canvas.addEventListener("mousemove", (evt) => {
    const mouse_pos = get_mouse_pos(g_canvas, evt);
    const hovered = hovered_cell(g_board, mouse_pos);
    paint_board(g_canvas, g_board, hovered);
  }, false);

  g_canvas.addEventListener("mousedown", (evt) => {
    const mouse_pos = get_mouse_pos(g_canvas, evt);
    const hovered = hovered_cell(g_board, mouse_pos);
    try_make_move(hovered);
  }, false);

  paint_board(g_canvas, g_board, null);
}

function try_make_move(coord: Coord) {
    const new_board = make_move(g_board, coord, g_current_player);
    if (new_board) {
      g_board = new_board;
      g_current_player = (g_current_player + 1) % num_players();
      paint_board(g_canvas, g_board, null);
      if (g_current_player >= g_num_humans) {
        setTimeout(make_ai_move, 100);
      }
    } else {
      console.error(`Cannot make move at ${coord_name(coord)} for player ${player_name(g_current_player)}`);
    }
}

function make_ai_move() {
  const coord = ai_move(g_board, g_current_player);
  console.info(`AI ${player_name(g_current_player)}: ${coord_name(coord)}`);
  try_make_move(coord);
  paint_board(g_canvas, g_board, null);
}

export function on_size_change(size: number) {
  g_board_size = size;
  document.getElementById("size_label").innerHTML = `Size: ${size}x${size}`;
  new_game();
}

export function on_humans_change(humans: number) {
  document.getElementById("humans_label").innerHTML = `Humans: ${humans}`;
  g_num_humans = humans;
}

export function on_cpus_change(cpus: number) {
  document.getElementById("cpus_label").innerHTML = `Bots: ${cpus}`;
  g_num_cpus = cpus;
}

export function new_game() {
  console.log(`Starting new ${g_board_size}x${g_board_size} game with ${g_num_humans} and  ${g_num_cpus} cpus.`);
  g_board = make_board(g_board_size);
  g_current_player = 0;
  paint_board(g_canvas, g_board, null);
  if (g_num_humans === 0) {
    make_ai_move();
  }
}

(document as any).on_size_change = on_size_change; // HACK
(document as any).on_humans_change = on_humans_change; // HACK
(document as any).on_cpus_change = on_cpus_change; // HACK
(document as any).new_game = new_game; // HACK

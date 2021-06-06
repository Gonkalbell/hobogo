use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Write},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use eframe::{
    egui::{self, color::Color32, math::*, paint::TextStyle, widgets::*, Align, Painter, Ui},
    epi,
};

use crate::{
    hobogo::{Board, Coord, Player},
    mcts,
};

const STORAGE_FILE_NAME: &str = "hobogo.json";

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
pub struct Settings {
    board_size: usize,
    num_humans: usize,
    num_bots: usize,
    humans_first: bool,
    bot_think_time: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            board_size: 9,
            num_humans: 1,
            num_bots: 1,
            humans_first: true,
            bot_think_time: 1.,
        }
    }
}

impl Settings {
    fn num_players(&self) -> usize {
        (self.num_humans + self.num_bots) as usize
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct State {
    settings: Settings,
    board: Board,
    next_player: Player,
}

impl State {
    fn new(settings: Settings) -> Self {
        let first_player = if settings.humans_first {
            0
        } else {
            settings.num_humans as Player
        };
        State {
            settings,
            board: Board::new(settings.board_size as i32, settings.board_size as i32),
            next_player: first_player,
        }
    }

    pub fn is_valid(&self) -> bool {
        self.settings.num_players() >= 2 && (self.next_player as usize) < self.num_players()
    }

    pub fn from_local_storage() -> Option<Self> {
        #[cfg(target_arch = "wasm32")]
        let state: Option<State> =
            egui_web::local_storage_get("hobogo_state").map(|s| serde_json::from_str(&s).ok())?;
        #[cfg(not(target_arch = "wasm32"))]
        let state: Option<State> = File::open(STORAGE_FILE_NAME).ok().and_then(|mut f| {
            let mut buf = String::new();
            f.read_to_string(&mut buf).ok()?;
            serde_json::from_str(&buf).ok()
        });

        if let Some(state) = state {
            if state.is_valid() {
                return Some(state);
            }
        }
        None
    }

    pub fn save_to_local_storage(&self) -> bool {
        let json_string = serde_json::to_string(&self);
        #[cfg(target_arch = "wasm32")]
        {
            json_string
                .map(|s| egui_web::local_storage_set("hobogo_state", &s))
                .is_ok()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            json_string
                .map(|s| {
                    let mut f = File::create(STORAGE_FILE_NAME)?;
                    write!(&mut f, "{}", s)
                })
                .is_ok()
        }
    }

    pub fn new_or_restore() -> Self {
        State::from_local_storage().unwrap_or_else(|| State::new(Settings::default()))
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct App {
    state: State,

    #[serde(skip_serializing)]
    undo_stack: VecDeque<State>,

    #[serde(skip_serializing)]
    ai_frame_delay: usize,
}

impl epi::App for App {
    fn update(&mut self, ctx: &eframe::egui::CtxRef, _frame: &mut eframe::epi::Frame<'_>) {
        eframe::egui::CentralPanel::default().show(ctx, |ui| {
            let width = (ui.max_rect().height() - 100.0) * 0.8; // This is a bit ugly
            let width = width.min(ui.max_rect().width() - 22.0);
            let x = ui.available_size().x / 2.0 - width / 2.0;
            let mut ui = ui.child_ui(
                Rect::from_min_size(pos2(x, 0.0), vec2(width, ui.available_size().y)),
                *ui.layout(),
            );
            self.show_gui(&mut ui);
        });
    }

    fn name(&self) -> &str {
        "hobogo"
    }
}

impl App {
    pub fn restore_or_new() -> Self {
        App {
            state: State::new_or_restore(),
            undo_stack: Default::default(),
            ai_frame_delay: 0,
        }
    }

    pub fn show_gui(&mut self, ui: &mut Ui) {
        ui.with_layout(egui::Layout::top_down(Align::Center), |ui| {
            ui.add(Label::new("HOBOGO").text_style(TextStyle::Heading));
        });
        self.show_settings(ui);

        ui.with_layout(egui::Layout::top_down(Align::Center), |ui| {
            self.state.show_whos_next(ui);
        });

        self.show_board_and_interact(ui);

        ui.columns(2, |cols| {
            if cols[0].add(Button::new("New Game")).clicked() {
                if !self.state.board.is_empty() {
                    self.undo_stack.push_back(self.state.clone());
                }
                self.state = State::new(self.state.settings);
                self.state.save_to_local_storage();
            }
            if !self.undo_stack.is_empty() && cols[0].add(Button::new("Undo")).clicked() {
                self.state = self.undo_stack.pop_back().unwrap();
            }
            self.state.show_score(&mut cols[1]);
        });
    }

    fn show_settings(&mut self, ui: &mut Ui) {
        ui.style_mut().spacing.slider_width = ui
            .style()
            .spacing
            .slider_width
            .min(ui.max_rect().width() / 6.0);

        let mut settings = self.state.settings;
        ui.columns(2, |cols| {
            cols[0].add(Slider::new(&mut settings.num_humans, 0..=4).text("Humans"));
            cols[0].add(Slider::new(&mut settings.num_bots, 0..=4).text("Bots"));
            cols[0]
                .add(Slider::new(&mut settings.bot_think_time, 0.01..=3.).text("Bot Think Time"));
            cols[1].add(Slider::new(&mut settings.board_size, 5..=17).text("Size"));
            cols[1]
                .checkbox(&mut settings.humans_first, "Humans go first")
                .on_hover_text("Going first is a big advantage");
        });

        while settings.num_players() < 2 {
            settings.num_humans += 1;
        }

        if settings != self.state.settings {
            if !self.state.board.is_empty() {
                self.undo_stack.push_back(self.state.clone());
            }
            self.state = State::new(settings);
            self.state.save_to_local_storage();
        }
    }

    fn show_board_and_interact(&mut self, ui: &mut Ui) {
        // Add spacing before the board:
        ui.add_space(8.0);

        let size = ui.max_rect().width() - 32.0; // Leave space for row numbers
        let (board_id, rect) = ui.allocate_space(vec2(size, size));
        let board_interact = ui.interact(rect, board_id, egui::Sense::click());

        // HACK: Add some spacing for the column names
        ui.add_space(32.0);

        let state = &mut self.state;

        if !state.board.is_game_over(state.num_players()) {
            if state.next_player_is_human() {
                if board_interact.hovered() {
                    if let Some(mouse_pos) = ui.input().pointer.interact_pos() {
                        if let Some(hovered_coord) = hovered_coord(&state.board, &rect, mouse_pos) {
                            if state.board.is_valid_move(
                                hovered_coord,
                                state.next_player,
                                state.num_players(),
                            ) {
                                if board_interact.clicked() {
                                    self.undo_stack.push_back(state.clone());
                                    state.board[hovered_coord] = Some(state.next_player);
                                    state.next_player =
                                        (state.next_player + 1) % (state.num_players() as u8);
                                    state.save_to_local_storage();
                                } else {
                                    let mut preview = state.clone();
                                    preview.board[hovered_coord] = Some(state.next_player);
                                    return preview.show_board(rect, ui.painter());
                                }
                            }
                        }
                    }
                }
            } else {
                if ui.ctx().is_using_pointer() {
                    // Don't do anything slow while the user is e.g. dragging a slider
                } else {
                    // This is slow. TODO: run in background thread... when wasm supports it.

                    if self.ai_frame_delay < 6 {
                        // HACK: Give WebGL time to catch up visually
                        self.ai_frame_delay += 1;
                    } else {
                        self.ai_frame_delay = 0;

                        if let Some(coord) = state.ai_move(state.next_player, state.num_players()) {
                            state.board[coord] = Some(state.next_player);
                        }
                        state.next_player = (state.next_player + 1) % (state.num_players() as u8);
                    }
                }
                ui.ctx().request_repaint();
            }
        }

        state.show_board(rect, ui.painter());
    }
}

impl State {
    pub fn show_whos_next(&mut self, ui: &mut Ui) {
        if self.board.is_game_over(self.num_players()) {
            ui.add(Label::new("Game over!"));
        } else {
            let player_color = player_color(self.next_player);
            let player_name = self.player_name(self.next_player);
            if self.next_player_is_human() {
                ui.add(Label::new(format!("{} to play", player_name)).text_color(player_color));
            } else {
                ui.add(
                    Label::new(format!("{} is thinking...", player_name)).text_color(player_color),
                );
            }
        }
    }

    pub fn show_score(&mut self, ui: &mut Ui) {
        ui.columns(2, |cols| {
            let score = self.board.points();
            for pi in 0..self.num_players() {
                let player_color = player_color(pi as Player);
                let player_name = self.player_name(pi as Player);
                cols[0].add(Label::new(format!("{}", player_name)).text_color(player_color));
                cols[1].add(Label::new(format!("{}", score[pi])).text_color(player_color));
            }
        });

        /*
        let score = self.board.points();
        let mut cursor = ui.cursor();
        for pi in 0..self.num_players() {
            let player_color = player_color(pi as Player);
            let player_name = self.player_name(pi as Player);
            let text_size = ui.floating_text(
                cursor + vec2(32.0, 0.0),
                &player_name,
                TextStyle::Body,
                (Align::Min, Align::Min),
                Some(player_color),
            );
            ui.floating_text(
                vec2(cursor.x, cursor.y),
                &score[pi].to_string(),
                TextStyle::Body,
                (Align::Min, Align::Min),
                Some(player_color),
            );
            cursor.y += text_size.y;
        }
        */
    }

    fn num_players(&self) -> usize {
        self.settings.num_players()
    }

    fn is_human(&self, player: Player) -> bool {
        (player as usize) < self.settings.num_humans
    }

    fn next_player_is_human(&self) -> bool {
        self.is_human(self.next_player) && !self.board.is_game_over(self.num_players())
    }

    fn player_name(&self, player: Player) -> String {
        let mut name = match player {
            0 => "Yellow".to_string(),
            1 => "Pink".to_string(),
            2 => "Green".to_string(),
            3 => "Purple".to_string(),
            i => i.to_string(),
        };

        if !self.is_human(player) {
            name += " (bot)";
        }

        name
    }

    fn show_board(&self, rect: Rect, painter: &Painter) {
        let board = &self.board;
        let spacing = rect.width() / (board.width as f32);
        let volatile = board.volatile_cells(self.num_players());

        let cell_side = spacing * 0.84;
        let corner_radius = (cell_side * 0.25).round();

        if self.next_player_is_human() {
            // Highlight who is to play next
            painter.rect_stroke(
                rect.expand(4.0),
                corner_radius * 2.0f32.sqrt(),
                (2.0, player_color(self.next_player)),
            );
        }

        for c in board.coords() {
            let center = rect.min + spacing * vec2(c.x as f32 + 0.5, c.y as f32 + 0.5);

            let is_volatile = volatile[board.index(c).unwrap()];
            let fill = self.cell_color(c, is_volatile);

            if let Some(_player) = board[c] {
                let rect = Rect::from_center_size(center, vec2(cell_side, cell_side));
                painter.rect_filled(rect, corner_radius, fill);
            } else {
                painter.circle_filled(center, 0.2 * spacing, fill);
            }
        }

        let text_color = Color32::from_rgba_premultiplied(100, 100, 100, 255);

        // Name chess column names:
        for x in 0..board.width {
            painter.text(
                rect.min + vec2((x as f32 + 0.5) * spacing, rect.height() + 12.0),
                Align2::LEFT_CENTER,
                &column_name(x),
                TextStyle::Body,
                text_color,
            );
        }

        // Name chess row names:
        for y in 0..board.height {
            painter.text(
                rect.min + vec2(rect.width() + 12.0, (y as f32 + 0.5) * spacing),
                Align2::CENTER_BOTTOM,
                &row_name(y),
                TextStyle::Body,
                text_color,
            );
        }
    }

    fn cell_color(&self, c: Coord, is_volatile: bool) -> Color32 {
        let influence = self.board.influence(c);
        if let Some(claimer) = influence.player() {
            let color = player_color(claimer);
            if is_volatile || influence.is_occupied() {
                color
            } else {
                Color32::from_rgba_premultiplied(
                    color.r() / 2,
                    color.g() / 2,
                    color.b() / 2,
                    color.a(),
                ) // Darker
            }
        } else if self.next_player_is_human()
            && !self
                .board
                .is_valid_move(c, self.next_player, self.num_players())
        {
            // The currant human can't move here
            Color32::from_rgba_premultiplied(90, 90, 100, 255)
        } else {
            // Free (at least for some)
            Color32::from_rgba_premultiplied(150, 150, 160, 255)
        }
    }

    pub fn ai_move(&self, player: Player, num_players: usize) -> Option<Coord> {
        use rand::SeedableRng;
        let mut rng = rand::rngs::SmallRng::from_entropy(); // Fast

        let state = mcts::GameState {
            next_player: player,
            num_players,
            board: self.board.clone(),
        };

        let think_time = self.settings.bot_think_time;
        let mut mcts = mcts::Mcts::new(state);
        #[cfg(target_arch = "wasm32")]
        let start = egui_web::now_sec();
        #[cfg(not(target_arch = "wasm32"))]
        let start = Instant::now();
        while {
            mcts.iterate(&mut rng);
            #[cfg(target_arch = "wasm32")]
            {
                egui_web::now_sec() - start < think_time as f64
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                Instant::now() - start < Duration::from_secs_f32(think_time)
            }
        } {}

        let action = mcts.best_action().cloned();

        if let Some(action) = action {
            match action {
                mcts::Action::Pass => None,
                mcts::Action::Move(coord) => Some(coord),
            }
        } else {
            None
        }
    }
}

fn player_color(player: Player) -> Color32 {
    match player {
        // 0 => Color32::from_rgba_premultiplied(85, 119, 255, 255),
        // 1 => Color32::from_rgba_premultiplied(205, 0, 0, 255),
        // 2 => Color32::from_rgba_premultiplied(0, 255, 0, 255),
        // _ => Color32::from_rgba_premultiplied(221, 221, 0, 255),
        0 => Color32::from_rgba_premultiplied(239, 169, 0, 255),
        1 => Color32::from_rgba_premultiplied(242, 73, 117, 255),
        2 => Color32::from_rgba_premultiplied(31, 187, 171, 255),
        _ => Color32::from_rgba_premultiplied(121, 68, 219, 255),
    }
}

/// Chess coordinate name
fn column_name(x: i32) -> String {
    ((65 + (x as u8)) as char).to_string()
}

/// Chess coordinate name
fn row_name(y: i32) -> String {
    y.to_string()
}

fn hovered_coord(board: &Board, rect: &Rect, mouse_pos: Pos2) -> Option<Coord> {
    let spacing = rect.width() / (board.width as f32);
    for c in board.coords() {
        let x = c.x as f32 * spacing + rect.left();
        let y = c.y as f32 * spacing + rect.top();
        let left = x;
        let top = y;
        let right = x + spacing;
        let bottom = y + spacing;
        let is_hovering = left <= mouse_pos.x
            && mouse_pos.x <= right
            && top <= mouse_pos.y
            && mouse_pos.y <= bottom;
        if is_hovering {
            return Some(c);
        }
    }
    None
}

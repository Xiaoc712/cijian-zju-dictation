"""大英默写器：支持熟词管理、可回退练习和本地学习记录的 PyQt6 桌面应用。"""
from __future__ import annotations

import html
import json
import os
import random
import re
import sys
from typing import Optional

from PyQt6.QtCore import Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QColor, QFont, QIcon, QPainter, QPixmap, QTextCursor
from PyQt6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QFrame, QHBoxLayout, QLabel,
    QLineEdit, QMainWindow, QMessageBox, QProgressBar, QPushButton, QScrollArea,
    QSizePolicy, QTextEdit, QVBoxLayout, QWidget,
)

import theme
from engine import GameEngine
from model import DataLoader, WordEntry
from theme import SegmentedControl, Switch, card, hline

APP_TITLE = "大英默写器"
APP_SUBTITLE = "一点一滴，把单词变成熟悉的语言"
FOOTER_TEXT = "本地保存学习记录  ·  仅供学习，请勿商用  ·  原作者 Lucent_Snow"


def app_dir() -> str:
    base = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    # 兼容原安装目录，以及工作区中的开发词库。
    for candidate in (base, os.path.dirname(base), os.path.join(base, "test-app")):
        if os.path.isdir(os.path.join(candidate, "data")):
            return candidate
    return base


def make_app_icon() -> QIcon:
    for base in (os.path.dirname(os.path.abspath(__file__)), app_dir()):
        path = os.path.join(base, "app.ico")
        if os.path.isfile(path):
            icon = QIcon(path)
            if not icon.isNull():
                return icon
    pm = QPixmap(128, 128)
    pm.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pm)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setBrush(QColor(theme.C["primary"]))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawRoundedRect(4, 4, 120, 120, 30, 30)
    painter.setFont(QFont("Microsoft YaHei UI", 52, QFont.Weight.Bold))
    painter.setPen(Qt.GlobalColor.white)
    painter.drawText(pm.rect(), Qt.AlignmentFlag.AlignCenter, "词")
    painter.end()
    return QIcon(pm)


class AnswerEdit(QLineEdit):
    previous_requested = pyqtSignal()
    next_requested = pyqtSignal()
    mastered_requested = pyqtSignal()
    undo_mastered_requested = pyqtSignal()

    def keyPressEvent(self, event):  # noqa: N802
        command = None
        if event.modifiers() == Qt.KeyboardModifier.ControlModifier and event.key() == Qt.Key.Key_K:
            command = self.mastered_requested
        elif event.modifiers() == (Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.ShiftModifier) and event.key() == Qt.Key.Key_Z:
            command = self.undo_mastered_requested
        if command is not None:
            if not event.isAutoRepeat():
                command.emit()
            event.accept()
            return
        if event.modifiers() == Qt.KeyboardModifier.NoModifier and event.key() in (Qt.Key.Key_Up, Qt.Key.Key_Down):
            if not event.isAutoRepeat():
                (self.previous_requested if event.key() == Qt.Key.Key_Up else self.next_requested).emit()
            event.accept()
            return
        super().keyPressEvent(event)


class MainWindow(QMainWindow):
    def __init__(self, data_directory: Optional[str] = None, storage_directory: Optional[str] = None):
        super().__init__()
        self.storage_directory = os.path.abspath(storage_directory or app_dir())
        self.loader = DataLoader(data_directory=data_directory or os.path.join(app_dir(), "data"))
        self.engine = GameEngine(self.loader, storage_directory=self.storage_directory)
        self.preferences_path = os.path.join(self.storage_directory, "preferences.json")
        self.keybindings = self.load_keybindings()
        self.current_word: Optional[WordEntry] = None
        self.running = False
        self.log_entries: list[tuple[str, str]] = []
        self.drafts: dict[int, str] = {}
        self.example_cache: dict[int, str] = {}
        self.last_mastered: Optional[WordEntry] = None
        self.last_mastered_index: Optional[int] = None
        self.setWindowTitle(APP_TITLE + " · 专注学习")
        self.setWindowIcon(make_app_icon())
        self.resize(1200, 860)
        self.setMinimumSize(800, 680)
        self.init_ui()
        self.populate_books_combo()
        self.restore_preferences()
        self.update_review_button_count()
        self.show_idle_state()
        if self.engine.persistence_warnings:
            self.set_alert("error", "；".join(self.engine.persistence_warnings))

    @staticmethod
    def button(text, callback, object_name=""):
        button = QPushButton(text)
        button.setObjectName(object_name)
        button.setCursor(Qt.CursorShape.PointingHandCursor)
        button.clicked.connect(callback)
        return button

    def init_ui(self):
        root = QWidget()
        root.setObjectName("Root")
        layout = QVBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self._build_header())
        layout.addWidget(self._build_body(), 1)
        footer = QLabel(FOOTER_TEXT)
        footer.setObjectName("Footer")
        footer.setAlignment(Qt.AlignmentFlag.AlignCenter)
        footer.setContentsMargins(16, 8, 16, 16)
        layout.addWidget(footer)
        self.setCentralWidget(root)

    def _build_header(self):
        header = QFrame()
        header.setObjectName("Header")
        layout = QHBoxLayout(header)
        layout.setContentsMargins(30, 18, 30, 18)
        layout.setSpacing(14)
        mark = QLabel("词")
        mark.setObjectName("HeaderMark")
        mark.setFixedSize(44, 44)
        mark.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(mark)
        titles = QVBoxLayout()
        titles.setSpacing(3)
        title = QLabel(APP_TITLE)
        title.setObjectName("HeaderTitle")
        subtitle = QLabel(APP_SUBTITLE)
        subtitle.setObjectName("HeaderSub")
        titles.addWidget(title)
        titles.addWidget(subtitle)
        layout.addLayout(titles)
        layout.addStretch()
        self.btn_mastered_list = self.button("熟词库 · 0", self.show_mastered_dialog, "HeaderBtn")
        self.btn_record = self.button("学习记录", self.show_record_dialog, "HeaderBtn")
        self.btn_help = self.button("帮助", self.show_help_dialog, "HeaderBtn")
        self.btn_settings = self.button("练习设置", self.toggle_settings_panel, "HeaderBtn")
        for button in (self.btn_mastered_list, self.btn_record, self.btn_help, self.btn_settings):
            layout.addWidget(button)
        return header

    def _build_body(self):
        body = QWidget()
        layout = QHBoxLayout(body)
        layout.setContentsMargins(28, 22, 28, 0)
        layout.setSpacing(22)
        left = QWidget()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(2, 2, 2, 2)
        left_layout.setSpacing(18)
        heading = QVBoxLayout()
        heading.setSpacing(5)
        eyebrow = QLabel("LEARN AT YOUR OWN PACE")
        eyebrow.setObjectName("Eyebrow")
        self.hero_title = QLabel("今天，也进步一点。")
        self.hero_title.setObjectName("HeroTitle")
        self.hero_description = QLabel("自由回看，跳过犹豫；把已经熟悉的词，交给「斩」。")
        self.hero_description.setObjectName("HeroDescription")
        self.hero_description.setWordWrap(True)
        for label in (eyebrow, self.hero_title, self.hero_description):
            heading.addWidget(label)
        left_layout.addLayout(heading)
        stats = QHBoxLayout()
        stats.setSpacing(12)
        self.stat_values = {}
        for name, label in (("correct", "答对"), ("wrong", "答错"), ("skipped", "跳过"), ("mastered", "本轮已斩")):
            frame = QFrame()
            frame.setObjectName("StatCard")
            box = QVBoxLayout(frame)
            box.setContentsMargins(18, 12, 18, 12)
            box.setSpacing(2)
            value = QLabel("0")
            value.setObjectName("StatValue")
            caption = QLabel(label)
            caption.setObjectName("StatLabel")
            box.addWidget(value)
            box.addWidget(caption)
            self.stat_values[name] = value
            stats.addWidget(frame, 1)
        left_layout.addLayout(stats)

        practice = card()
        practice.setObjectName("PracticeCard")
        practice_layout = QVBoxLayout(practice)
        practice_layout.setContentsMargins(26, 24, 26, 24)
        practice_layout.setSpacing(18)
        meta = QHBoxLayout()
        meta.setSpacing(8)
        self.chip_book = QLabel("未开始")
        self.chip_book.setObjectName("ChipGray")
        self.chip_mode = QLabel("单词默写")
        self.chip_mode.setObjectName("Chip")
        self.chip_hint = QLabel("")
        self.chip_hint.setObjectName("Chip")
        self.chip_hint.hide()
        self.lbl_progress = QLabel("第 0 / 0 词")
        self.lbl_progress.setObjectName("ProgressText")
        for widget in (self.chip_book, self.chip_mode, self.chip_hint):
            meta.addWidget(widget)
        meta.addStretch()
        meta.addWidget(self.lbl_progress)
        practice_layout.addLayout(meta)
        prompt = QFrame()
        prompt.setObjectName("PromptBox")
        prompt_layout = QVBoxLayout(prompt)
        prompt_layout.setContentsMargins(22, 22, 22, 22)
        prompt_layout.setSpacing(12)
        self.lbl_question = QLabel("准备好开始了吗？")
        self.lbl_question.setObjectName("Question")
        self.lbl_question.setWordWrap(True)
        self.lbl_question.setTextFormat(Qt.TextFormat.PlainText)
        self.lbl_question.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.lbl_subquestion = QLabel("")
        self.lbl_subquestion.setObjectName("SubQuestion")
        self.lbl_subquestion.setWordWrap(True)
        self.lbl_subquestion.setTextFormat(Qt.TextFormat.PlainText)
        prompt_layout.addWidget(self.lbl_question)
        prompt_layout.addWidget(self.lbl_subquestion)
        practice_layout.addWidget(prompt)

        input_row = QHBoxLayout()
        input_row.setSpacing(12)
        self.input_line = AnswerEdit()
        self.input_line.setObjectName("Answer")
        self.input_line.setPlaceholderText("输入英文答案 · 自动忽略空格与大小写")
        self.input_line.setClearButtonEnabled(True)
        self.input_line.returnPressed.connect(self.submit_answer)
        self.input_line.previous_requested.connect(self.previous_word)
        self.input_line.next_requested.connect(self.skip_word)
        self.input_line.mastered_requested.connect(self.mark_mastered)
        self.input_line.undo_mastered_requested.connect(self.undo_mastered)
        self.input_line.textEdited.connect(lambda: self.set_answer_state(""))
        self.btn_submit = self.button("提交  ↵", self.submit_answer, "Submit")
        input_row.addWidget(self.input_line, 1)
        input_row.addWidget(self.btn_submit)
        practice_layout.addLayout(input_row)
        navigation = QHBoxLayout()
        navigation.setSpacing(10)
        self.btn_previous = self.button("↑ 上一词", self.previous_word, "Navigation")
        self.btn_skip = self.button("↓ 下一词", self.skip_word, "Navigation")
        self.btn_skip.setToolTip("跳过当前词；保留已有错题记录。下次仍会测试。")
        self.btn_mastered = self.button("斩 · 已熟知", self.mark_mastered, "Mastered")
        self.btn_mastered.setToolTip("Ctrl+K：保存为熟词，本轮后续同词与下次测验不再出现。")
        navigation.addWidget(self.btn_previous)
        navigation.addWidget(self.btn_skip)
        navigation.addStretch()
        navigation.addWidget(self.btn_mastered)
        practice_layout.addLayout(navigation)
        hints = QHBoxLayout()
        self.key_hint = QLabel("↑ 回退    ↓ 跳过    Ctrl+K 斩词")
        self.key_hint.setObjectName("KeyHint")
        self.btn_undo = self.button("撤销上次斩词", self.undo_mastered, "Link")
        self.btn_undo.setToolTip("Ctrl+Shift+Z：撤销最近一次斩词")
        self.btn_undo.setEnabled(False)
        hints.addWidget(self.key_hint)
        hints.addStretch()
        hints.addWidget(self.btn_undo)
        practice_layout.addLayout(hints)
        self.alert_frame = QFrame()
        self.alert_frame.setObjectName("AlertInfo")
        alert_layout = QHBoxLayout(self.alert_frame)
        alert_layout.setContentsMargins(14, 12, 14, 12)
        self.lbl_alert = QLabel("")
        self.lbl_alert.setObjectName("AlertText")
        self.lbl_alert.setTextFormat(Qt.TextFormat.PlainText)
        self.lbl_alert.setWordWrap(True)
        alert_layout.addWidget(self.lbl_alert)
        practice_layout.addWidget(self.alert_frame)
        progress_row = QHBoxLayout()
        progress_row.setSpacing(12)
        self.progress = QProgressBar()
        self.progress.setObjectName("AntProgress")
        self.progress.setTextVisible(False)
        self.progress.setRange(0, 100)
        self.progress.setFixedHeight(6)
        self.lbl_progress_pct = QLabel("0%")
        self.lbl_progress_pct.setObjectName("ProgressText")
        progress_row.addWidget(self.progress, 1)
        progress_row.addWidget(self.lbl_progress_pct)
        practice_layout.addLayout(progress_row)
        left_layout.addWidget(practice)

        log_card = card()
        log_layout = QVBoxLayout(log_card)
        log_layout.setContentsMargins(20, 16, 20, 16)
        log_layout.setSpacing(8)
        log_header = QHBoxLayout()
        title = QLabel("本轮学习记录")
        title.setObjectName("CardTitle")
        log_header.addWidget(title)
        log_header.addStretch()
        log_header.addWidget(self.button("查看全部", self.show_record_dialog, "Link"))
        log_header.addWidget(self.button("清空", self.clear_log, "Link"))
        log_layout.addLayout(log_header)
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        self.log_area.setFixedHeight(110)
        self.log_area.setPlaceholderText("每一次作答，都会记录在这里。")
        log_layout.addWidget(self.log_area)
        left_layout.addWidget(log_card)
        left_layout.addStretch()
        scroll = QScrollArea()
        scroll.setObjectName("PageScroll")
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setWidget(left)
        layout.addWidget(scroll, 1)
        self.page_scroll = scroll
        self.drawer = self._build_drawer()
        layout.addWidget(self.drawer)
        return body

    @staticmethod
    def _group_label(text):
        label = QLabel(text)
        label.setObjectName("DrawerGroup")
        return label

    def _build_drawer(self):
        drawer = QFrame()
        drawer.setObjectName("Drawer")
        drawer.setFixedWidth(318)
        outer = QVBoxLayout(drawer)
        outer.setContentsMargins(20, 22, 16, 20)
        outer.setSpacing(14)
        head = QHBoxLayout()
        title = QLabel("练习设置")
        title.setObjectName("DrawerTitle")
        head.addWidget(title)
        head.addStretch()
        head.addWidget(self.button("收起", self.toggle_settings_panel, "Link"))
        outer.addLayout(head)
        note = QLabel("按自己的节奏，安排这一轮练习。")
        note.setObjectName("SettingsNote")
        note.setWordWrap(True)
        outer.addWidget(note)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inner = QWidget()
        layout = QVBoxLayout(inner)
        layout.setContentsMargins(0, 0, 6, 0)
        layout.setSpacing(12)
        scroll.setWidget(inner)
        outer.addWidget(scroll, 1)
        layout.addWidget(self._group_label("词书"))
        self.book_combo = QComboBox()
        self.book_combo.currentTextChanged.connect(self.populate_units_checkboxes)
        layout.addWidget(self.book_combo)
        unit_header = QHBoxLayout()
        unit_header.addWidget(self._group_label("练习单元"))
        unit_header.addStretch()
        self.cb_select_all = QCheckBox("全选")
        self.cb_select_all.setTristate(True)
        self.cb_select_all.setCheckState(Qt.CheckState.Checked)
        self.cb_select_all.clicked.connect(self.toggle_all_units)
        unit_header.addWidget(self.cb_select_all)
        layout.addLayout(unit_header)
        self.unit_scroll_area = QScrollArea()
        self.unit_scroll_area.setObjectName("UnitList")
        self.unit_scroll_area.setWidgetResizable(True)
        self.unit_scroll_area.setMinimumHeight(100)
        self.unit_scroll_area.setMaximumHeight(128)
        self.unit_container = QWidget()
        self.unit_container.setObjectName("UnitListInner")
        self.unit_layout = QVBoxLayout(self.unit_container)
        self.unit_layout.setContentsMargins(8, 8, 8, 8)
        self.unit_layout.setSpacing(8)
        self.unit_layout.addStretch()
        self.unit_scroll_area.setWidget(self.unit_container)
        self.unit_checkboxes = []
        layout.addWidget(self.unit_scroll_area)
        layout.addWidget(hline())
        for label, attr, options in (
            ("练习内容", "seg_content", ["全部", "单词", "短语"]),
            ("出题顺序", "seg_order", ["顺序", "随机"]),
            ("作答模式", "seg_question", ["单词默写", "例句填空"]),
        ):
            layout.addWidget(self._group_label(label))
            control = SegmentedControl(options)
            setattr(self, attr, control)
            layout.addWidget(control)
        layout.addWidget(hline())
        self.sw_first_letter = Switch()
        self.sw_retry = Switch()
        for text, switch in (("显示首字母提示", self.sw_first_letter), ("答错后重试", self.sw_retry)):
            row = QHBoxLayout()
            row.addWidget(QLabel(text))
            row.addStretch()
            switch.setAccessibleName(text)
            row.addWidget(switch)
            layout.addLayout(row)
        layout.addStretch()
        self.settings_scroll = scroll
        outer.addWidget(hline())
        self.start_button = self.button("开始练习  →", self.start_game, "Primary")
        outer.addWidget(self.start_button)
        self.review_button = self.button("复习错题 · 0", self.start_review)
        actions = QHBoxLayout()
        actions.setSpacing(8)
        actions.addWidget(self.review_button, 1)
        self.clear_wrong_button = self.button("清空错题本", self.clear_wrong_words, "Link")
        actions.addWidget(self.clear_wrong_button)
        outer.addLayout(actions)
        tips = QLabel("熟词会自动排除；跳过的词仍会在下次练习中出现。")
        tips.setObjectName("SettingsNote")
        tips.setWordWrap(True)
        outer.addWidget(tips)
        return drawer

    def toggle_settings_panel(self):
        self.drawer.setVisible(self.drawer.isHidden())
        self.btn_settings.setText("收起设置" if not self.drawer.isHidden() else "练习设置")
        self._adapt_layout()

    def _adapt_layout(self):
        # 小窗口显示设置时，聚焦于设置；关掉设置即可回到完整练习区域。
        if hasattr(self, "drawer"):
            self.page_scroll.setVisible(self.width() >= 1040 or self.drawer.isHidden())

    def resizeEvent(self, event):  # noqa: N802
        super().resizeEvent(event)
        self._adapt_layout()
        if hasattr(self, "lbl_question"):
            QTimer.singleShot(0, self._fit_prompt_height)

    def _fit_prompt_height(self):
        for label in (self.lbl_question, self.lbl_subquestion):
            height = label.heightForWidth(max(200, label.width()))
            if height > 0:
                label.setMinimumHeight(height)

    def toggle_all_units(self):
        checked = self.cb_select_all.checkState() != Qt.CheckState.Unchecked
        for checkbox in self.unit_checkboxes:
            checkbox.blockSignals(True)
            checkbox.setChecked(checked)
            checkbox.blockSignals(False)
        self._sync_unit_selection()

    def _sync_unit_selection(self):
        count = sum(checkbox.isChecked() for checkbox in self.unit_checkboxes)
        state = Qt.CheckState.Checked if count and count == len(self.unit_checkboxes) else (
            Qt.CheckState.PartiallyChecked if count else Qt.CheckState.Unchecked)
        self.cb_select_all.blockSignals(True)
        self.cb_select_all.setCheckState(state)
        self.cb_select_all.blockSignals(False)

    def populate_books_combo(self):
        books = sorted(self.loader.get_available_books(), key=self._natural_key)
        self.book_combo.blockSignals(True)
        self.book_combo.clear()
        self.book_combo.addItems(books)
        self.book_combo.blockSignals(False)
        self.populate_units_checkboxes()

    @staticmethod
    def _natural_key(text):
        return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", text)]

    def populate_units_checkboxes(self):
        for checkbox in self.unit_checkboxes:
            self.unit_layout.removeWidget(checkbox)
            checkbox.deleteLater()
        self.unit_checkboxes = []
        for name in sorted(self.loader.get_units_for_book(self.book_combo.currentText()), key=self._natural_key):
            checkbox = QCheckBox(name)
            checkbox.setChecked(True)
            checkbox.stateChanged.connect(self._sync_unit_selection)
            self.unit_layout.insertWidget(self.unit_layout.count() - 1, checkbox)
            self.unit_checkboxes.append(checkbox)
        self._sync_unit_selection()

    def load_keybindings(self):
        defaults = {
            "/skip": "action_skip_no_penalty", "/prev": "action_previous",
            "/cut": "action_mastered", "/斩": "action_mastered",
            "/review": "action_start_review", "/clc": "action_clear_cache",
            "/clear": "action_clear_screen",
        }
        path = os.path.join(self.storage_directory, "keybindings.json")
        try:
            with open(path, encoding="utf-8") as stream:
                bindings = json.load(stream)
            if isinstance(bindings, dict):
                # 旧版的单字母 a 与正常答案冲突，命令统一以 / 开头。
                defaults.update({key: value for key, value in bindings.items()
                                 if isinstance(key, str) and key.startswith("/") and isinstance(value, str)})
        except (OSError, ValueError):
            pass
        return defaults

    def restore_preferences(self):
        try:
            with open(self.preferences_path, encoding="utf-8") as stream:
                preferences = json.load(stream)
            if not isinstance(preferences, dict):
                return
            book = preferences.get("book", "")
            if self.book_combo.findText(book) >= 0:
                self.book_combo.setCurrentText(book)
            units = preferences.get("units")
            if isinstance(units, list):
                for checkbox in self.unit_checkboxes:
                    checkbox.setChecked(checkbox.text() in units)
            for attr, maximum in (("seg_content", 2), ("seg_order", 1), ("seg_question", 1)):
                index = preferences.get(attr, 0)
                if isinstance(index, int) and 0 <= index <= maximum:
                    getattr(self, attr).set_current(index)
            self.sw_first_letter.setChecked(bool(preferences.get("first_letter", False)))
            self.sw_retry.setChecked(bool(preferences.get("retry", False)))
            self._sync_unit_selection()
        except (OSError, ValueError, TypeError):
            pass

    def save_preferences(self):
        preferences = {
            "book": self.book_combo.currentText(),
            "units": [checkbox.text() for checkbox in self.unit_checkboxes if checkbox.isChecked()],
            "first_letter": self.sw_first_letter.isChecked(), "retry": self.sw_retry.isChecked(),
            **{attr: getattr(self, attr).current_id() for attr in ("seg_content", "seg_order", "seg_question")},
        }
        try:
            os.makedirs(self.storage_directory, exist_ok=True)
            temporary = self.preferences_path + ".tmp"
            with open(temporary, "w", encoding="utf-8") as stream:
                json.dump(preferences, stream, ensure_ascii=False, indent=2)
            os.replace(temporary, self.preferences_path)
            return True
        except OSError as error:
            self.append_to_log(f"练习设置未能保存：{error}", "red")
            return False

    def closeEvent(self, event):  # noqa: N802
        self.save_preferences()
        super().closeEvent(event)

    def update_review_button_count(self):
        count = self.engine.get_wrong_word_count()
        self.review_button.setText(f"复习错题 · {count}")
        self.review_button.setEnabled(count > 0)
        self.btn_mastered_list.setText(f"熟词库 · {self.engine.get_mastered_word_count()}")

    def show_idle_state(self):
        self.running = False
        self.current_word = None
        self.input_line.setEnabled(False)
        for button in (self.btn_submit, self.btn_skip, self.btn_previous, self.btn_mastered):
            button.setEnabled(False)
        self.lbl_question.setText("准备好开始了吗？")
        self.lbl_subquestion.setText("在右侧选择词书与单元，点击「开始练习」。熟词会自动排除。")
        self.chip_book.setText("未开始")
        self.chip_hint.hide()
        self.progress.setValue(0)
        self.lbl_progress_pct.setText("0%")
        self.lbl_progress.setText("第 0 / 0 词")
        if self.loader.get_available_books():
            self.set_alert("info", "输入答案后按 Enter 提交；答案自动忽略所有空格与大小写。")
        else:
            self.start_button.setEnabled(False)
            self.set_alert("error", "没有找到词库，请将 data 文件夹放在程序旁边。")
        QTimer.singleShot(0, self._fit_prompt_height)

    def update_progress_ui(self):
        current, total = self.engine.get_progress()
        percent = min(100, round(current / total * 100)) if total else 0
        self.progress.setValue(percent)
        self.lbl_progress_pct.setText(f"{percent}%")
        self.lbl_progress.setText(f"第 {min(current + 1, total)} / {total} 词")
        for key, value in self.engine.get_session_stats().items():
            if key in self.stat_values:
                self.stat_values[key].setText(str(value))
        self.btn_previous.setEnabled(total > 0 and current > 0)

    def set_answer_state(self, state):
        self.input_line.setProperty("answerState", state)
        self.input_line.style().unpolish(self.input_line)
        self.input_line.style().polish(self.input_line)

    def set_alert(self, kind, text):
        names = {"success": ("AlertSuccess", "AlertTextSuccess"), "error": ("AlertError", "AlertTextError")}
        frame_name, label_name = names.get(kind, ("AlertInfo", "AlertText"))
        self.alert_frame.setObjectName(frame_name)
        self.lbl_alert.setObjectName(label_name)
        self.lbl_alert.setText(text)
        for widget in (self.alert_frame, self.lbl_alert):
            widget.style().unpolish(widget)
            widget.style().polish(widget)

    def append_to_log(self, message, color="black"):
        colors = {"black": "#334155", "blue": theme.C["primary"], "green": "#12856B",
                  "red": "#D04453", "gray": "#7B8597", "darkGray": "#64748B"}
        hex_color = colors.get(color, color)
        self.log_entries.append((message, hex_color))
        self.log_area.setTextColor(QColor(hex_color))
        # insertText 避免 CSV 或输入被 QTextEdit 当作 HTML 解释。
        cursor = self.log_area.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        if not self.log_area.document().isEmpty():
            cursor.insertBlock()
        self.log_area.setTextCursor(cursor)
        self.log_area.insertPlainText(message)
        self.log_area.ensureCursorVisible()

    def clear_log(self):
        self.log_entries.clear()
        self.log_area.clear()

    def _render_log_html(self):
        return "".join(f'<p style="color:{color};margin:6px 0;">{html.escape(text)}</p>'
                       for text, color in self.log_entries) or "<p>暂无记录</p>"

    def show_record_dialog(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("学习记录")
        dialog.resize(700, 520)
        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(24, 24, 24, 24)
        title = QLabel("本轮学习记录")
        title.setObjectName("DrawerTitle")
        layout.addWidget(title)
        view = QTextEdit()
        view.setReadOnly(True)
        view.setHtml(self._render_log_html())
        layout.addWidget(view, 1)
        row = QHBoxLayout()
        row.addWidget(self.button("清空记录", lambda: (self.clear_log(), view.setHtml(self._render_log_html()))))
        row.addStretch()
        row.addWidget(self.button("关闭", dialog.accept, "Primary"))
        layout.addLayout(row)
        dialog.exec()

    def show_help_dialog(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("使用帮助")
        dialog.resize(640, 540)
        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(24, 24, 24, 24)
        view = QTextEdit()
        view.setReadOnly(True)
        view.setHtml("""
            <h2>把练习留给还不熟悉的词。</h2>
            <p>选择词书与单元，组合内容、出题顺序和作答模式，开始练习。</p>
            <p><b>Enter</b> 提交。答案忽略大小写、首尾和中间的所有空白；短语也可连写。拼写与标点仍需正确。</p>
            <p>输入框中按 <b>↑</b> 回到上一词，按 <b>↓</b> 跳过当前词。随机模式会沿本轮固定顺序回退。未提交的输入会保留；重复作答会更新该题统计。</p>
            <p><b>斩 · 已熟知</b>（Ctrl+K）：保存为熟词，本轮后续相同词和下次测验都会排除。熟词按英文匹配，词书中的不同释义也会一起排除。</p>
            <p><b>撤销上次斩词</b>（Ctrl+Shift+Z），或在「熟词库」搜索并恢复词条；恢复后可重新测试。</p>
            <p>答错自动加入错题本。复习时只有答对才移除；跳过、中途退出均会保留未掌握的词。可开启答错后重试。</p>
            <p>例句填空只需输入单词原形；没有挖空例句的词会在开局排除。首字母提示按本轮设置显示。</p>
            <p>输入命令后回车：/skip 跳过，/prev 上一词，/cut 或 /斩 斩词，/review 复习，/clear 清空本轮记录，/clc 清空错题。</p>
            <p>设置与学习数据保存在本机程序目录。原作者：Lucent_Snow。</p>
        """)
        layout.addWidget(view, 1)
        layout.addWidget(self.button("知道了", dialog.accept, "Primary"))
        dialog.exec()

    def show_mastered_dialog(self):
        dialog = QDialog(self)
        dialog.setWindowTitle("熟词库")
        dialog.resize(660, 540)
        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(14)
        title = QLabel("已经熟悉的词")
        title.setObjectName("HeroTitle")
        layout.addWidget(title)
        description = QLabel("这些词不会再出题。恢复后，下一轮练习会重新包含它们。")
        description.setObjectName("HeroDescription")
        description.setWordWrap(True)
        layout.addWidget(description)
        search = QLineEdit()
        search.setPlaceholderText("搜索英文或中文释义")
        layout.addWidget(search)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        layout.addWidget(scroll, 1)
        count = QLabel("")
        count.setObjectName("KeyHint")
        layout.addWidget(count)

        def restore(word):
            try:
                self.engine.restore_mastered_word(word)
            except OSError as error:
                self.persistence_error(error)
                QMessageBox.warning(dialog, "未能恢复", "熟词记录未能保存，请检查目录是否可写。")
                return
            if self.last_mastered == word:
                self.last_mastered = None
                self.btn_undo.setEnabled(False)
            self.update_review_button_count()
            self.append_to_log(f"已恢复熟词：{self._get_clean_english(word)}", "blue")
            refresh()

        def refresh():
            container = QWidget()
            rows = QVBoxLayout(container)
            rows.setContentsMargins(0, 0, 8, 0)
            rows.setSpacing(10)
            query = search.text().strip().casefold()
            words = sorted(self.engine.mastered_words, key=lambda word: word.english.casefold())
            matched = [word for word in words if query in word.english.casefold() or query in word.chinese.casefold()]
            for word in matched:
                frame = card()
                row = QHBoxLayout(frame)
                row.setContentsMargins(14, 12, 14, 12)
                labels = QVBoxLayout()
                english = QLabel(self._get_clean_english(word))
                english.setTextFormat(Qt.TextFormat.PlainText)
                english.setObjectName("CardTitle")
                chinese = QLabel(self._extract_chinese_hint(word.chinese))
                chinese.setObjectName("SubQuestion")
                chinese.setWordWrap(True)
                labels.addWidget(english)
                labels.addWidget(chinese)
                row.addLayout(labels, 1)
                row.addWidget(self.button("恢复测试", lambda _=False, entry=word: restore(entry)))
                rows.addWidget(frame)
            if not matched:
                label = QLabel("没有匹配的熟词。" if words else "还没有斩过词。熟悉的词，可以在练习时标记。")
                label.setWordWrap(True)
                rows.addWidget(label)
            rows.addStretch()
            old = scroll.takeWidget()
            if old:
                old.deleteLater()
            scroll.setWidget(container)
            count.setText(f"共 {len(words)} 个熟词 · 当前显示 {len(matched)} 个")

        search.textChanged.connect(refresh)
        refresh()
        layout.addWidget(self.button("完成", dialog.accept, "Primary"))
        dialog.exec()

    @staticmethod
    def _extract_chinese_hint(text):
        matches = re.findall(r"[\u4e00-\u9fff][\u4e00-\u9fff；，。（）·、！？：]*", text)
        return " / ".join(matches) if matches else text

    @staticmethod
    def _get_clean_english(word):
        return word.english.split(",")[0].strip()

    def _start_session_ui(self, title):
        self.running = True
        self.clear_log()
        self.drafts.clear()
        self.example_cache.clear()
        self.last_mastered = None
        self.last_mastered_index = None
        self.btn_undo.setEnabled(False)
        self.append_to_log(title, "blue")
        self.hero_title.setText("专注眼前的这一词。")
        self.hero_description.setText("空格交给程序，拼写交给你。熟悉的词，随时可以斩。")
        self.input_line.setEnabled(True)
        self.input_line.setPlaceholderText("输入英文答案 · 自动忽略空格与大小写")
        self.btn_submit.setEnabled(True)
        self.btn_skip.setEnabled(True)
        self.btn_mastered.setEnabled(True)
        self.update_review_button_count()
        self.chip_mode.setText("例句填空" if self.engine.question_mode == "example" else "单词默写")
        if not self.drawer.isHidden():
            self.toggle_settings_panel()
        self.set_alert("info", "Enter 提交 · ↑ 上一词 · ↓ 下一词 · Ctrl+K 斩熟词")
        self.ask_next_question()

    def start_game(self):
        book = self.book_combo.currentText()
        units = [checkbox.text() for checkbox in self.unit_checkboxes if checkbox.isChecked()]
        if not book or not units:
            self.set_alert("info", "请至少选择一本词书和一个单元。")
            return
        self.engine.start_game(
            book, units, ("all", "words_only", "phrases_only")[self.seg_content.current_id()],
            "random" if self.seg_order.current_id() else "sequential",
            "example" if self.seg_question.current_id() else "word",
            self.sw_first_letter.isChecked(), self.sw_retry.isChecked(),
        )
        if not self.engine.current_deck:
            self.show_idle_state()
            self.update_progress_ui()
            self.set_alert("info", "当前选择没有待测词：可能已全部斩过，或没有符合筛选的例句。可调整设置或在熟词库恢复。")
            return
        preferences_saved = self.save_preferences()
        self.chip_book.setText(f"{book} · {len(units)} 个单元")
        self._start_session_ui(f"开始练习 · {book} · {len(self.engine.current_deck)} 词")
        if not preferences_saved:
            self.set_alert("error", "练习已开始，但设置未能保存；请检查程序目录是否可写。")

    def start_review(self):
        if not self.engine.start_review_mode():
            self.set_alert("info", "目前没有待复习的错题。")
            return
        self.engine.question_mode = "word"
        self.engine.show_first_letter = self.sw_first_letter.isChecked()
        self.engine.retry_on_wrong = self.sw_retry.isChecked()
        self.chip_book.setText("错题复习")
        self._start_session_ui(f"开始错题复习 · {len(self.engine.current_deck)} 词")

    def ask_next_question(self):
        self.current_word = self.engine.get_next_question()
        self.update_progress_ui()
        if self.current_word is None:
            self.on_deck_finished()
            return
        self.running = True
        self.input_line.setEnabled(True)
        self.btn_submit.setEnabled(True)
        self.btn_skip.setEnabled(True)
        self.btn_mastered.setEnabled(not self.engine.is_mastered(self.current_word))
        self.set_answer_state("")
        english = self._get_clean_english(self.current_word)
        hint = self._extract_chinese_hint(self.current_word.chinese)
        first_letter = english[0].lower() if english else ""
        self.chip_hint.setText(f"首字母 {first_letter}")
        self.chip_hint.setVisible(self.engine.show_first_letter)
        if self.engine.question_mode == "example":
            index = self.engine.current_index
            if index not in self.example_cache:
                sentences = [sentence for sentence in self.current_word.examples.split("；")
                             if re.search(r"\[\[.+?\]\]", sentence)]
                sentence = random.choice(sentences) if sentences else self.current_word.examples
                prefix = first_letter + "" if self.engine.show_first_letter else ""
                self.example_cache[index] = re.sub(r"\[\[.*?\]\]", prefix + "________", sentence)
            self.lbl_question.setText(self.example_cache[index])
            self.lbl_subquestion.setText(f"{hint} · 请填写单词原形。")
        else:
            self.lbl_question.setText(hint)
            self.lbl_subquestion.setText("请写出对应的英文单词或短语。")
        self.input_line.setText(self.drafts.get(self.engine.current_index, ""))
        self.input_line.setFocus()
        self.input_line.setCursorPosition(len(self.input_line.text()))
        QTimer.singleShot(0, self._fit_prompt_height)

    def on_deck_finished(self):
        self.running = False
        self.current_word = None
        self.update_progress_ui()
        self.btn_submit.setEnabled(False)
        self.btn_skip.setEnabled(False)
        self.btn_mastered.setEnabled(False)
        self.input_line.clear()
        self.input_line.setEnabled(True)  # 完成后仍可用 ↑ 回到最后一词。
        self.input_line.setPlaceholderText("本轮已结束 · 按 ↑ 可回看，或打开设置开始下一轮")
        self.input_line.setFocus()
        self.chip_hint.hide()
        stats = self.engine.get_session_stats()
        answered = stats["correct"] + stats["wrong"]
        accuracy = f"{round(stats['correct'] / answered * 100)}%" if answered else "—"
        self.hero_title.setText("这一轮，完成了。")
        self.hero_description.setText("回看不确定的词，或继续下一轮练习。")
        self.lbl_question.setText("每一次练习，都算数。")
        self.lbl_subquestion.setText(f"答对 {stats['correct']} · 答错 {stats['wrong']} · 跳过 {stats['skipped']} · 已斩 {stats['mastered']} · 正确率 {accuracy}")
        self.set_alert("success", f"本轮结束。错题本中还有 {self.engine.get_wrong_word_count()} 个待复习词；可按 ↑ 回看或打开练习设置。")
        self.append_to_log(self.lbl_subquestion.text(), "green")
        QTimer.singleShot(0, self._fit_prompt_height)

    def persistence_error(self, error):
        self.set_alert("error", "学习记录未能保存，当前题保留。请检查程序目录是否可写。")
        self.append_to_log(f"保存失败：{error}", "red")

    def submit_answer(self):
        user_input = self.input_line.text().strip()
        if user_input in self.keybindings:
            self.input_line.clear()
            self.handle_action(self.keybindings[user_input])
            return
        if not self.running or self.current_word is None:
            return
        if not user_input:
            self.set_alert("info", "先输入答案，再按 Enter；想跳过可以按 ↓。")
            return
        index = self.engine.current_index
        answer = self._get_clean_english(self.current_word)
        self.drafts[index] = user_input
        try:
            correct = self.engine.check_answer(user_input)
        except OSError as error:
            self.persistence_error(error)
            return
        self.update_review_button_count()
        self.update_progress_ui()
        if correct:
            self.append_to_log(f"✓ {answer}", "green")
            self.set_alert("success", f"正确 · {answer}")
            self.ask_next_question()
        else:
            self.append_to_log(f"× 输入 {user_input} · 正确答案 {answer}", "red")
            self.set_alert("error", f"正确答案：{answer}" + (" · 再试一次。" if self.engine.retry_on_wrong else ""))
            if self.engine.retry_on_wrong:
                self.set_answer_state("wrong")
                self.input_line.selectAll()
                self.input_line.setFocus()
            else:
                self.ask_next_question()

    def _save_draft(self):
        if self.current_word is not None:
            self.drafts[self.engine.current_index] = self.input_line.text()

    def previous_word(self):
        current = self.engine.current_index
        if not self.engine.current_deck or current == 0:
            self.set_alert("info", "已经是本轮第一个词。")
            return
        self._save_draft()
        self.engine.previous_question()
        self.hero_title.setText("专注眼前的这一词。")
        self.hero_description.setText("回看与重答，会更新这一词的本轮统计。")
        self.set_alert("info", "已回到上一词；重复作答只更新该题统计。")
        self.ask_next_question()

    def skip_word(self):
        if not self.running or self.current_word is None:
            return
        self._save_draft()
        skipped = self.engine.skip_without_penalty()
        if skipped:
            self.append_to_log(f"→ 跳过 {self._get_clean_english(skipped)}", "gray")
            self.set_alert("info", "已跳过。已有错题记录会保留，下次练习仍会出现。")
        self.ask_next_question()

    def mark_mastered(self):
        if not self.running or self.current_word is None:
            return
        index = self.engine.current_index
        self._save_draft()
        try:
            word = self.engine.mark_current_mastered()
        except OSError as error:
            self.persistence_error(error)
            return
        if word:
            self.last_mastered = word
            self.last_mastered_index = index
            self.btn_undo.setEnabled(True)
            name = self._get_clean_english(word)
            self.append_to_log(f"斩 · {name} · 已加入熟词库", "green")
            self.set_alert("success", f"已斩「{name}」。后续测验自动排除，可随时撤销或在熟词库恢复。")
            self.update_review_button_count()
        self.ask_next_question()

    def undo_mastered(self):
        if self.last_mastered is None:
            return
        word = self.last_mastered
        try:
            self.engine.restore_mastered_word(word)
        except OSError as error:
            self.persistence_error(error)
            return
        self._save_draft()
        if self.last_mastered_index is not None:
            self.engine.current_index = self.last_mastered_index
            # 撤销斩词时该题重新等待作答。
            self.engine.results.pop(self.last_mastered_index, None)
        self.last_mastered = None
        self.last_mastered_index = None
        self.btn_undo.setEnabled(False)
        self.update_review_button_count()
        self.hero_title.setText("专注眼前的这一词。")
        self.set_alert("info", f"已撤销斩词「{self._get_clean_english(word)}」，回到该词继续练习。")
        self.append_to_log(f"撤销斩词 · {self._get_clean_english(word)}", "blue")
        self.ask_next_question()

    def handle_action(self, name):
        actions = {
            "action_skip_no_penalty": self.skip_word, "action_previous": self.previous_word,
            "action_mastered": self.mark_mastered, "action_start_review": self.start_review,
            "action_clear_cache": self.clear_wrong_words, "action_clear_screen": self.clear_log,
        }
        if name in actions:
            actions[name]()
        else:
            self.set_alert("error", f"未知命令：{name}")

    def clear_wrong_words(self):
        if not self.engine.wrong_words:
            self.set_alert("info", "错题本已经是空的。")
            return
        reply = QMessageBox.question(self, "清空错题本", "清空全部错题记录？这个操作无法撤销。",
                                     QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                                     QMessageBox.StandardButton.No)
        if reply != QMessageBox.StandardButton.Yes:
            return
        try:
            self.engine.clear_wrong_words_cache()
        except OSError as error:
            self.persistence_error(error)
            return
        self.update_review_button_count()
        self.set_alert("success", "错题本已清空。")
        self.append_to_log("错题本已清空", "blue")


def main():
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setApplicationName(APP_TITLE)
    font = QFont()
    font.setFamilies(["Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "Arial"])
    font.setPointSize(10)
    app.setFont(font)
    app.setStyleSheet(theme.stylesheet(theme.generate_assets()))
    app.setWindowIcon(make_app_icon())
    window = MainWindow()
    window.show()
    if "--selftest" in sys.argv:
        index = sys.argv.index("--selftest")
        output = sys.argv[index + 1] if len(sys.argv) > index + 1 else os.path.join(app_dir(), "selftest.png")
        def snapshot():
            window.grab().save(output)
            with open(output + ".txt", "w", encoding="utf-8") as stream:
                stream.write("books=" + ",".join(window.loader.get_available_books()) + "\n")
                stream.write("units=" + ",".join(window.loader.get_units_for_book(window.book_combo.currentText())) + "\n")
            app.quit()
        QTimer.singleShot(1200, snapshot)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()

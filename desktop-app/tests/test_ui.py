"""Desktop integration tests using real Qt keyboard events and isolated records.

Run with ``python -m unittest discover -s tests -p test_ui.py -v``. The local
build dependencies in .build-libs are used automatically when available; a
different full PyQt6 installation can be supplied through DICTATION_QT_LIBS.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


APP_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIRECTORY))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

dependency_directory = Path(os.environ.get("DICTATION_QT_LIBS", APP_DIRECTORY / ".build-libs"))
if (dependency_directory / "PyQt6").is_dir():
    sys.path.insert(0, str(dependency_directory))
    plugin_directory = dependency_directory / "PyQt6" / "Qt6" / "plugins"
    if plugin_directory.is_dir():
        os.environ.setdefault("QT_QPA_PLATFORM_PLUGIN_PATH", str(plugin_directory))

if importlib.util.find_spec("PyQt6") is None:
    raise RuntimeError("UI tests require a full PyQt6 installation (including QtTest).")

from PyQt6.QtCore import Qt
from PyQt6.QtTest import QTest
from PyQt6.QtWidgets import QApplication, QMessageBox

import main
import theme


class DesktopInteractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.application = QApplication.instance() or QApplication([])
        cls.application.setQuitOnLastWindowClosed(False)
        cls.application.setStyleSheet(theme.stylesheet({}))

    def setUp(self):
        test_temporary_root = APP_DIRECTORY / ".build-tmp"
        test_temporary_root.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="dictation-ui-tests-", dir=test_temporary_root)
        self.directory = Path(self.temporary.name)
        self.data_directory = self.directory / "data"
        self.storage_directory = self.directory / "records"
        self.storage_directory.mkdir()
        self.write_unit("book1", "Unit 1.csv", [
            ("take care of", "照顾", "I [[take care of]] her.；They [[take care of]] us."),
            ("apple", "苹果", "An [[apple]] a day."),
            ("book", "书", "This is a [[book]]."),
            ("a", "一个", "This is [[a]] tree."),
        ])
        self.write_unit("book2", "Unit 1.csv", [("pear", "梨", "A [[pear]].")])
        self.write_unit("book2", "Unit 2.csv", [("green tea", "绿茶", "I drink [[green tea]].")])
        self.windows = []
        self.message_patches = [
            patch.object(QMessageBox, name, return_value=QMessageBox.StandardButton.No)
            for name in ("question", "information", "warning", "critical")
        ]
        for message_patch in self.message_patches:
            message_patch.start()
        self.window = self.new_window()

    def tearDown(self):
        for window in reversed(self.windows):
            window.close()
            window.deleteLater()
        self.application.processEvents()
        for message_patch in reversed(self.message_patches):
            message_patch.stop()
        self.temporary.cleanup()

    def write_unit(self, book, filename, words):
        book_directory = self.data_directory / book
        book_directory.mkdir(parents=True, exist_ok=True)
        with (book_directory / filename).open("w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(("english", "chinese", "examples"))
            writer.writerows(words)

    def new_window(self):
        window = main.MainWindow(str(self.data_directory), str(self.storage_directory))
        self.windows.append(window)
        window.show()
        window.activateWindow()
        self.application.processEvents()
        QTest.qWait(5)
        return window

    def start(self, window=None):
        window = window or self.window
        QTest.mouseClick(window.start_button, Qt.MouseButton.LeftButton)
        self.application.processEvents()
        self.assertTrue(window.running)
        self.assertIsNotNone(window.current_word)
        window.input_line.setFocus()
        self.application.processEvents()

    def press(self, key, modifiers=Qt.KeyboardModifier.NoModifier, window=None):
        window = window or self.window
        window.activateWindow()
        window.input_line.setFocus()
        self.application.processEvents()
        QTest.keyClick(window.input_line, key, modifiers)
        self.application.processEvents()

    def answer(self, text, window=None):
        window = window or self.window
        window.input_line.setText(text)
        self.press(Qt.Key.Key_Return, window=window)

    def read_record(self, filename):
        with (self.storage_directory / filename).open(encoding="utf-8") as stream:
            return json.load(stream)

    def test_enter_accepts_case_and_internal_unicode_spaces(self):
        self.start()
        self.answer(" \tTAKE\u3000 care\u00a0OF  ")
        self.assertEqual(self.window.engine.current_index, 1)
        self.assertEqual(self.window.current_word.english, "apple")
        self.assertEqual(self.window.stat_values["correct"].text(), "1")
        self.assertEqual(self.window.engine.get_wrong_word_count(), 0)
        self.answer("A P P L E")
        self.assertEqual(self.window.current_word.english, "book")

    def test_empty_enter_does_not_advance_or_create_wrong_record(self):
        self.start()
        self.answer(" \t\u3000 ")
        self.assertEqual(self.window.engine.current_index, 0)
        self.assertEqual(self.window.engine.results, {})
        self.assertFalse((self.storage_directory / "wrong_words.json").exists())
        self.assertIn("先输入答案", self.window.lbl_alert.text())

    def test_arrows_preserve_each_draft_and_skip_without_penalty(self):
        self.start()
        self.window.input_line.setText("take ca")
        self.press(Qt.Key.Key_Down)
        self.assertEqual(self.window.current_word.english, "apple")
        self.window.input_line.setText("appl")
        self.press(Qt.Key.Key_Up)
        self.assertEqual(self.window.current_word.english, "take care of")
        self.assertEqual(self.window.input_line.text(), "take ca")
        self.press(Qt.Key.Key_Up)
        self.assertEqual(self.window.engine.current_index, 0)
        self.assertEqual(self.window.input_line.text(), "take ca")
        self.press(Qt.Key.Key_Down)
        self.assertEqual(self.window.input_line.text(), "appl")
        self.assertEqual(self.window.engine.get_wrong_word_count(), 0)
        self.assertFalse((self.storage_directory / "wrong_words.json").exists())

    def test_finished_round_can_go_up_to_last_word_and_draft(self):
        self.start()
        for index in range(4):
            self.window.input_line.setText(f"draft {index}")
            self.press(Qt.Key.Key_Down)
        self.assertFalse(self.window.running)
        self.assertIsNone(self.window.current_word)
        self.assertEqual(self.window.progress.value(), 100)
        self.assertTrue(self.window.input_line.isEnabled())
        self.assertFalse(self.window.btn_submit.isEnabled())
        self.press(Qt.Key.Key_Up)
        self.assertTrue(self.window.running)
        self.assertEqual(self.window.engine.current_index, 3)
        self.assertEqual(self.window.current_word.english, "a")
        self.assertEqual(self.window.input_line.text(), "draft 3")
        self.assertTrue(self.window.btn_submit.isEnabled())

    def test_retry_keeps_wrong_question_and_reanswer_updates_count(self):
        self.window.sw_retry.setChecked(True)
        self.start()
        word = self.window.current_word
        self.answer("incorrect")
        self.assertEqual(self.window.engine.current_index, 0)
        self.assertEqual(self.window.current_word, word)
        self.assertEqual(self.window.input_line.property("answerState"), "wrong")
        self.assertEqual(self.window.input_line.selectedText(), "incorrect")
        self.answer("still incorrect")
        self.assertEqual(self.window.stat_values["wrong"].text(), "1")
        self.answer("takecareof")
        self.assertEqual(self.window.engine.current_index, 1)
        self.assertEqual(self.window.stat_values["correct"].text(), "1")
        self.assertEqual(self.window.stat_values["wrong"].text(), "0")
        self.assertEqual([row["english"] for row in self.read_record("wrong_words.json")], ["take care of"])

    def test_ctrl_k_persists_mastered_word_and_restart_excludes_it(self):
        self.start()
        word = self.window.current_word
        self.press(Qt.Key.Key_K, Qt.KeyboardModifier.ControlModifier)
        self.assertEqual(self.window.current_word.english, "apple")
        self.assertTrue(self.window.engine.is_mastered(word))
        self.assertEqual(self.window.stat_values["mastered"].text(), "1")
        self.assertTrue(self.window.btn_undo.isEnabled())
        self.assertEqual([row["english"] for row in self.read_record("mastered_words.json")], ["take care of"])
        self.window.close()
        restarted = self.new_window()
        self.start(restarted)
        self.assertEqual(restarted.current_word.english, "apple")
        self.assertEqual(len(restarted.engine.current_deck), 3)
        self.assertNotIn(word, restarted.engine.current_deck)

    def test_undo_shortcut_restores_cut_word_and_returns_to_saved_draft(self):
        self.start()
        word = self.window.current_word
        self.window.input_line.setText("take ca")
        self.press(Qt.Key.Key_K, Qt.KeyboardModifier.ControlModifier)
        self.press(Qt.Key.Key_Down)
        self.assertEqual(self.window.engine.current_index, 2)
        self.press(Qt.Key.Key_Z, Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.ShiftModifier)
        self.assertEqual(self.window.engine.current_index, 0)
        self.assertEqual(self.window.current_word, word)
        self.assertEqual(self.window.input_line.text(), "take ca")
        self.assertFalse(self.window.engine.is_mastered(word))
        self.assertEqual(self.read_record("mastered_words.json"), [])
        self.assertFalse(self.window.btn_undo.isEnabled())
        self.assertEqual(self.window.stat_values["mastered"].text(), "0")
        self.assertNotIn(0, self.window.engine.results)

    def test_review_start_and_skip_keep_wrong_records_correct_clears_only_current(self):
        self.start()
        self.answer("wrong first")
        self.answer("wrong second")
        initial = (self.storage_directory / "wrong_words.json").read_bytes()
        self.window.start_review()
        self.application.processEvents()
        self.assertTrue(self.window.engine.review_mode)
        self.assertEqual((self.storage_directory / "wrong_words.json").read_bytes(), initial)
        first = self.window.current_word
        self.press(Qt.Key.Key_Down)
        self.assertEqual((self.storage_directory / "wrong_words.json").read_bytes(), initial)
        self.press(Qt.Key.Key_Up)
        self.assertEqual(self.window.current_word, first)
        self.answer(first.english)
        remaining = self.window.engine.wrong_words.copy()
        self.assertEqual(len(remaining), 1)
        self.assertNotIn(first, remaining)
        self.window.close()
        restarted = self.new_window()
        self.assertEqual(restarted.engine.wrong_words, remaining)
        restarted.start_review()
        self.assertEqual(set(restarted.engine.current_deck), remaining)

    def test_random_order_stays_fixed_when_navigating_back_and_forward(self):
        self.window.seg_order.set_current(1)
        with patch("engine.random.shuffle", side_effect=lambda words: words.reverse()):
            self.start()
        original = self.window.engine.current_deck.copy()
        self.assertEqual(original[0].english, "a")
        self.window.input_line.setText("first draft")
        self.press(Qt.Key.Key_Down)
        self.assertEqual(self.window.current_word, original[1])
        self.press(Qt.Key.Key_Up)
        self.assertEqual(self.window.current_word, original[0])
        self.assertEqual(self.window.input_line.text(), "first draft")
        self.assertEqual(self.window.engine.current_deck, original)

    def test_example_question_and_draft_stay_stable_on_return(self):
        self.window.seg_question.set_current(1)
        self.start()
        sentence = self.window.lbl_question.text()
        self.assertIn("________", sentence)
        self.assertNotIn("[[", sentence)
        self.window.input_line.setText("example draft")
        self.press(Qt.Key.Key_Down)
        self.press(Qt.Key.Key_Up)
        self.assertEqual(self.window.lbl_question.text(), sentence)
        self.assertEqual(self.window.input_line.text(), "example draft")

    def test_legacy_a_binding_cannot_intercept_a_normal_answer(self):
        self.window.close()
        with (self.storage_directory / "keybindings.json").open("w", encoding="utf-8") as stream:
            json.dump({"a": "action_skip_no_penalty", "/next": "action_skip_no_penalty"}, stream)
        restarted = self.new_window()
        self.assertNotIn("a", restarted.keybindings)
        self.assertIn("/next", restarted.keybindings)
        self.start(restarted)
        for _ in range(3):
            self.press(Qt.Key.Key_Down, window=restarted)
        self.assertEqual(restarted.current_word.english, "a")
        self.answer("a", restarted)
        self.assertEqual(restarted.engine.get_session_stats()["correct"], 1)
        self.assertEqual(restarted.engine.get_session_stats()["skipped"], 3)
        self.assertFalse(restarted.running)
        self.assertEqual(restarted.engine.get_wrong_word_count(), 0)

    def test_preferences_survive_close_and_restore_book_units_and_modes(self):
        self.window.book_combo.setCurrentText("book2")
        for checkbox in self.window.unit_checkboxes:
            checkbox.setChecked(checkbox.text() == "Unit 2.csv")
        self.window.seg_content.set_current(2)
        self.window.seg_order.set_current(1)
        self.window.seg_question.set_current(1)
        self.window.sw_first_letter.setChecked(True)
        self.window.sw_retry.setChecked(True)
        self.window.close()
        restarted = self.new_window()
        self.assertEqual(restarted.book_combo.currentText(), "book2")
        self.assertEqual([checkbox.text() for checkbox in restarted.unit_checkboxes if checkbox.isChecked()], ["Unit 2.csv"])
        self.assertEqual(restarted.cb_select_all.checkState(), Qt.CheckState.PartiallyChecked)
        self.assertEqual(restarted.seg_content.current_id(), 2)
        self.assertEqual(restarted.seg_order.current_id(), 1)
        self.assertEqual(restarted.seg_question.current_id(), 1)
        self.assertTrue(restarted.sw_first_letter.isChecked())
        self.assertTrue(restarted.sw_retry.isChecked())
        self.start(restarted)
        self.assertEqual(restarted.current_word.english, "green tea")
        self.assertEqual(restarted.engine.question_mode, "example")

    def test_failed_mastered_save_keeps_question_and_reports_error(self):
        self.start()
        word = self.window.current_word
        self.window.input_line.setText("unsaved draft")
        with patch.object(self.window.engine, "_save_words", side_effect=OSError("read only")):
            self.press(Qt.Key.Key_K, Qt.KeyboardModifier.ControlModifier)
        self.assertEqual(self.window.engine.current_index, 0)
        self.assertEqual(self.window.current_word, word)
        self.assertEqual(self.window.input_line.text(), "unsaved draft")
        self.assertFalse(self.window.engine.is_mastered(word))
        self.assertFalse(self.window.btn_undo.isEnabled())
        self.assertIn("学习记录未能保存", self.window.lbl_alert.text())
        self.assertFalse((self.storage_directory / "mastered_words.json").exists())


if __name__ == "__main__":
    unittest.main()

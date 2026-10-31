"""核心交互和数据安全测试；所有记录只写入临时目录。"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine import GameEngine
from model import WordEntry


class FakeLoader:
    def __init__(self, words):
        self.words = words.copy()

    def load_word_list(self, book, units):
        return self.words.copy()


class EngineTests(unittest.TestCase):
    def setUp(self):
        test_temporary_root = Path(__file__).resolve().parents[1] / ".build-tmp"
        test_temporary_root.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="dictation-engine-tests-", dir=test_temporary_root)
        self.assertTrue(Path(self.temporary.name).resolve().is_relative_to(test_temporary_root.resolve()))
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.words = [
            WordEntry("take care of, extra", "照顾", "I [[take care of]] her."),
            WordEntry("apple", "苹果", "An [[apple]] a day."),
            WordEntry("book", "书", "This is a [[book]]."),
        ]
        self.engine = GameEngine(FakeLoader(self.words), self.directory)
        self.start()

    def start(self, retry=False, mode="word", order="sequential", filter_mode="all"):
        self.engine.start_game("book", ["unit.csv"], filter_mode, order, mode, False, retry)

    def reload(self):
        return GameEngine(FakeLoader(self.words), self.directory)

    def test_answers_ignore_internal_unicode_whitespace_and_case(self):
        self.assertTrue(self.engine.check_answer(" \tTAKE\u3000 care\nof\u00a0"))
        self.assertTrue(self.engine.check_answer("A P P L E"))
        self.assertFalse(self.engine.check_answer("books"))
        self.assertEqual(self.engine.get_progress(), (3, 3))
        self.assertEqual(self.engine.get_wrong_word_count(), 1)
        self.assertEqual(self.reload().wrong_words, {self.words[2]})

    def test_expected_answer_only_uses_first_comma_segment(self):
        self.assertFalse(self.engine.check_answer("take care of, extra"))

    def test_navigation_keeps_fixed_random_order_and_supports_completed_state(self):
        with patch("engine.random.shuffle", side_effect=lambda deck: deck.reverse()):
            self.start(order="random")
        original_order = self.engine.current_deck.copy()
        self.assertEqual(self.engine.previous_question(), original_order[0])
        for _ in original_order:
            self.engine.skip_without_penalty()
        self.assertIsNone(self.engine.get_next_question())
        self.assertEqual(self.engine.previous_question(), original_order[-1])
        self.assertEqual(self.engine.previous_question(), original_order[-2])
        self.assertEqual(self.engine.current_deck, original_order)

    def test_skip_keeps_existing_wrong_records_and_adds_none(self):
        self.engine.check_answer("wrong")
        self.engine.previous_question()
        original_bytes = self.engine.wrong_words_path.read_bytes()
        self.engine.skip_without_penalty()
        self.engine.skip_without_penalty()
        self.assertEqual(self.engine.wrong_words, {self.words[0]})
        self.assertEqual(self.engine.wrong_words_path.read_bytes(), original_bytes)
        self.assertEqual(self.engine.get_session_stats()["skipped"], 2)

    def test_retry_updates_result_without_double_counting_or_losing_wrong_history(self):
        self.start(retry=True)
        self.assertFalse(self.engine.check_answer("wrong"))
        self.assertEqual(self.engine.current_index, 0)
        self.assertFalse(self.engine.check_answer("still wrong"))
        self.assertTrue(self.engine.check_answer("takecareof"))
        self.assertEqual(self.engine.current_index, 1)
        self.assertEqual(self.engine.get_session_stats(), {
            "correct": 1, "wrong": 0, "skipped": 0, "mastered": 0,
            "answered": 1, "total": 3,
        })
        self.assertIn(self.words[0], self.reload().wrong_words)
        self.engine.previous_question()
        self.engine.skip_without_penalty()
        self.assertEqual(self.engine.get_session_stats()["correct"], 0)
        self.assertEqual(self.engine.get_session_stats()["skipped"], 1)

    def test_review_does_not_clear_unfinished_records_and_correct_removes_only_answered(self):
        for _ in self.words:
            self.engine.check_answer("wrong")
        original_bytes = self.engine.wrong_words_path.read_bytes()
        with patch("engine.random.shuffle"):
            self.assertTrue(self.engine.start_review_mode())
        self.assertEqual(self.engine.wrong_words_path.read_bytes(), original_bytes)
        first = self.engine.get_next_question()
        self.assertTrue(self.engine.check_answer(first.english.split(",")[0]))
        self.assertNotIn(first, self.reload().wrong_words)
        skipped = self.engine.skip_without_penalty()
        self.assertIn(skipped, self.reload().wrong_words)
        last = self.engine.get_next_question()
        self.assertFalse(self.engine.check_answer("wrong"))
        self.assertEqual(self.reload().wrong_words, {skipped, last})

    def test_mastery_persists_across_definitions_and_can_be_restored(self):
        self.engine.check_answer("wrong")
        self.engine.previous_question()
        self.assertEqual(self.engine.mark_current_mastered(), self.words[0])
        self.assertEqual(self.engine.get_session_stats()["mastered"], 1)
        variant = WordEntry("TAKE\u3000CARE\tOF, another", "另一释义", "Another example")
        reloaded = self.reload()
        self.assertTrue(reloaded.is_mastered(variant))
        self.assertEqual(reloaded.get_mastered_word_count(), 1)
        self.assertEqual(reloaded.get_wrong_word_count(), 0)
        self.assertFalse(reloaded.start_review_mode())
        reloaded.loader.words = self.words + [variant]
        reloaded.start_game("book", [], "all", "sequential", "word", False, False)
        self.assertEqual(reloaded.current_deck, self.words[1:])
        self.assertTrue(reloaded.restore_mastered_word(variant))
        self.assertFalse(reloaded.restore_mastered_word(variant))
        self.assertEqual(self.reload().get_mastered_word_count(), 0)
        self.assertEqual(reloaded.get_wrong_word_count(), 1)
        self.assertTrue(reloaded.start_review_mode())

    def test_start_filters_invalid_examples_and_exact_duplicates_before_testing(self):
        self.engine.loader.words += [
            self.words[1], WordEntry("invalid", "坏数据", "Missing [[end"),
            WordEntry("empty", "空填空", "[[ \t ]]"),
            WordEntry("noblank", "未挖空", "An example with no blank."),
            WordEntry(", extra", "空答案", "[[missing]]"),
        ]
        self.start(mode="example")
        self.assertEqual(self.engine.current_deck, self.words)
        self.assertEqual(self.engine.get_progress(), (0, 3))
        self.start(filter_mode="phrases_only")
        self.assertEqual(self.engine.current_deck, [self.words[0]])

    def test_failed_wrong_save_preserves_state_and_previous_disk_data(self):
        self.engine.check_answer("wrong")
        original_bytes = self.engine.wrong_words_path.read_bytes()
        original_stats = self.engine.get_session_stats()
        with patch("engine.os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.engine.check_answer("wrong")
        self.assertEqual(self.engine.current_index, 1)
        self.assertEqual(self.engine.wrong_words, {self.words[0]})
        self.assertEqual(self.engine.get_session_stats(), original_stats)
        self.assertEqual(self.engine.wrong_words_path.read_bytes(), original_bytes)
        self.assertFalse(list(self.directory.glob("*.tmp")))

    def test_failed_mastery_save_and_restore_leave_memory_unchanged(self):
        with patch("engine.os.replace", side_effect=OSError("access denied")):
            with self.assertRaises(OSError):
                self.engine.mark_current_mastered()
        self.assertEqual(self.engine.current_index, 0)
        self.assertEqual(self.engine.get_mastered_word_count(), 0)
        self.assertEqual(self.engine.results, {})
        self.engine.mark_current_mastered()
        original_bytes = self.engine.mastered_words_path.read_bytes()
        with patch("engine.os.replace", side_effect=OSError("access denied")):
            with self.assertRaises(OSError):
                self.engine.restore_mastered_word(self.words[0])
        self.assertTrue(self.engine.is_mastered(self.words[0]))
        self.assertEqual(self.engine.mastered_words_path.read_bytes(), original_bytes)

    def test_failed_review_correct_save_keeps_question_and_error_record(self):
        self.engine.check_answer("wrong")
        self.engine.start_review_mode()
        with patch("engine.os.replace", side_effect=OSError("access denied")):
            with self.assertRaises(OSError):
                self.engine.check_answer("takecareof")
        self.assertEqual(self.engine.current_index, 0)
        self.assertEqual(self.engine.results, {})
        self.assertEqual(self.reload().wrong_words, {self.words[0]})

    def test_failed_clear_save_keeps_records(self):
        self.engine.check_answer("wrong")
        with patch("engine.os.replace", side_effect=OSError("access denied")):
            with self.assertRaises(OSError):
                self.engine.clear_wrong_words_cache()
        self.assertEqual(self.engine.wrong_words, {self.words[0]})

    def test_corrupt_json_remains_intact_until_original_is_safely_backed_up(self):
        original = b"{ corrupted recording"
        self.engine.wrong_words_path.write_bytes(original)
        reloaded = self.reload()
        self.assertTrue(reloaded.persistence_warnings)
        self.assertEqual(reloaded.wrong_words_path.read_bytes(), original)
        reloaded.start_game("book", [], "all", "sequential", "word", False, False)
        reloaded.check_answer("wrong")
        backups = list(self.directory.glob("wrong_words.json.corrupt-*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)
        self.assertEqual(json.loads(reloaded.wrong_words_path.read_text(encoding="utf-8")), [
            {"english": self.words[0].english, "chinese": self.words[0].chinese,
             "examples": self.words[0].examples},
        ])

    def test_invalid_schema_is_preserved_and_failed_backup_blocks_save(self):
        original = b'[{"english": 42}]'
        self.engine.mastered_words_path.write_bytes(original)
        reloaded = self.reload()
        reloaded.start_game("book", [], "all", "sequential", "word", False, False)
        with patch.object(Path, "read_bytes", side_effect=OSError("cannot read backup")):
            with self.assertRaises(OSError):
                reloaded.mark_current_mastered()
        self.assertEqual(reloaded.current_index, 0)
        self.assertEqual(reloaded.mastered_words, set())
        self.assertEqual(reloaded.mastered_words_path.read_bytes(), original)

    def test_empty_deck_operations_are_noops(self):
        self.engine.loader.words = []
        self.start()
        self.assertIsNone(self.engine.previous_question())
        self.assertIsNone(self.engine.skip_without_penalty())
        self.assertIsNone(self.engine.mark_current_mastered())
        self.assertFalse(self.engine.check_answer("anything"))
        self.assertEqual(self.engine.get_session_stats()["total"], 0)

    def test_mastery_skips_same_key_in_current_deck_and_previous_keeps_original_indices(self):
        variant = WordEntry("TAKE\u3000CARE OF", "另一释义", "They [[take care of]] us.")
        other_variant = WordEntry("takecareof, extra", "第三释义", "We [[take care of]] it.")
        deck = [self.words[0], variant, self.words[1], other_variant, self.words[2]]
        self.engine.loader.words = deck.copy()
        self.start()
        self.engine.mark_current_mastered()
        self.assertEqual(self.engine.get_next_question(), self.words[1])
        self.assertEqual(self.engine.current_index, 2)
        self.assertEqual(self.engine.previous_question(), self.words[1])
        self.assertEqual(self.engine.current_index, 2)
        self.engine.skip_without_penalty()
        self.assertEqual(self.engine.get_next_question(), self.words[2])
        self.assertEqual(self.engine.current_index, 4)
        self.assertEqual(self.engine.previous_question(), self.words[1])
        self.assertEqual(self.engine.current_index, 2)
        self.assertEqual(self.engine.current_deck, deck)
        self.assertEqual(self.engine.results, {0: "mastered", 2: "skipped"})
        self.assertEqual(self.engine.get_session_stats()["mastered"], 1)

    def test_completed_navigation_skips_mastered_tail_and_all_mastered_deck(self):
        self.engine.skip_without_penalty()
        self.engine.skip_without_penalty()
        self.engine.mark_current_mastered()
        self.assertIsNone(self.engine.get_next_question())
        self.assertEqual(self.engine.previous_question(), self.words[1])
        self.assertEqual(self.engine.current_index, 1)
        self.engine.loader.words = [self.words[0], WordEntry("takecareof", "照看", "")]
        self.start()
        self.engine.mark_current_mastered()
        self.assertIsNone(self.engine.get_next_question())
        self.assertEqual(self.engine.current_index, 2)
        self.assertIsNone(self.engine.previous_question())
        self.assertEqual(self.engine.get_session_stats()["mastered"], 1)

    def test_restore_leaves_other_results_and_can_return_to_original_cut_index(self):
        self.engine.mark_current_mastered()
        self.engine.check_answer("apple")
        original_results = self.engine.results.copy()
        self.engine.restore_mastered_word(self.words[0])
        self.assertEqual(self.engine.results, original_results)
        self.engine.current_index = 0
        self.engine.results.pop(0)
        self.assertEqual(self.engine.get_next_question(), self.words[0])
        self.assertEqual(self.engine.results, {1: "correct"})
        self.assertEqual(self.engine.get_session_stats()["mastered"], 0)


if __name__ == "__main__":
    unittest.main()

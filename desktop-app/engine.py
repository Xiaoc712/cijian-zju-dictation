"""测验状态、错题和熟词的持久化；界面只负责展示这些状态。"""

from __future__ import annotations

import json
import os
import random
import re
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Set
from uuid import uuid4

from model import DataLoader, WordEntry

WRONG_WORDS_FILE = "wrong_words.json"
MASTERED_WORDS_FILE = "mastered_words.json"


class GameEngine:
    def __init__(self, loader: DataLoader, storage_directory=None):
        self.loader = loader
        # 不依赖启动位置的应用可显式传入目录；保留旧版使用 cwd 的行为。
        self.storage_directory = Path(storage_directory or os.getcwd()).resolve()
        self.wrong_words_path = self.storage_directory / WRONG_WORDS_FILE
        self.mastered_words_path = self.storage_directory / MASTERED_WORDS_FILE

        self.all_words: List[WordEntry] = []
        self.current_deck: List[WordEntry] = []
        self.current_index = 0
        self.question_mode = "word"
        self.show_first_letter = False
        self.retry_on_wrong = False
        self.review_mode = False
        self.results: Dict[int, str] = {}

        self.wrong_words: Set[WordEntry] = set()
        self.mastered_words: Set[WordEntry] = set()
        self.persistence_warnings: List[str] = []
        self._unreadable_paths: Set[Path] = set()
        self._preserved_paths: Dict[Path, Path] = {}
        self._load_wrong_words_from_disk()
        self.mastered_words = self._load_words(self.mastered_words_path)
        # 兼容手工编辑或旧数据中的同词不同释义：熟词每个 key 只存一条。
        unique_mastered = {}
        for word in sorted(self.mastered_words, key=self._sort_key):
            unique_mastered.setdefault(self._word_key(word), word)
        self.mastered_words = set(unique_mastered.values())

    @staticmethod
    def normalize_answer(text: str) -> str:
        """忽略大小写和所有 Unicode 空白，包括中间空格、tab、全角空格。"""
        return "".join(text.split()).casefold()

    @classmethod
    def _word_key(cls, word: WordEntry) -> str:
        return cls.normalize_answer(word.english.split(",", 1)[0])

    @staticmethod
    def _sort_key(word: WordEntry):
        return (word.english.casefold(), word.chinese, word.examples)

    def _load_words(self, path: Path) -> Set[WordEntry]:
        try:
            with path.open("r", encoding="utf-8-sig") as stream:
                data = json.load(stream)
            if not isinstance(data, list):
                raise ValueError("记录必须为 JSON 列表")
            words = set()
            for row in data:
                if not isinstance(row, dict):
                    raise ValueError("单词记录必须为对象")
                values = [row.get(name, "") for name in ("english", "chinese", "examples")]
                if any(not isinstance(value, str) for value in values):
                    raise ValueError("单词字段必须为文本")
                word = WordEntry(*values)
                if not self._word_key(word):
                    raise ValueError("单词记录缺少英文")
                words.add(word)
            return words
        except FileNotFoundError:
            return set()
        except (OSError, UnicodeError, ValueError, TypeError) as exc:
            self._unreadable_paths.add(path)
            self.persistence_warnings.append(
                f"无法读取 {path.name}：{exc}。原文件保持不变；下次保存前会备份原内容。"
            )
            return set()

    def _load_wrong_words_from_disk(self):
        self.wrong_words = self._load_words(self.wrong_words_path)

    def _preserve_unreadable_file(self, path: Path):
        """异常记录必须先成功备份，才能被新记录替换。"""
        if path not in self._unreadable_paths or path in self._preserved_paths:
            return
        backup = path.with_name(f"{path.name}.corrupt-{uuid4().hex[:12]}.bak")
        try:
            original = path.read_bytes()
            with backup.open("xb") as stream:
                stream.write(original)
                stream.flush()
                os.fsync(stream.fileno())
        except OSError as exc:
            raise OSError(f"无法备份异常记录 {path.name}，本次保存已取消：{exc}") from exc
        self._preserved_paths[path] = backup
        self.persistence_warnings.append(f"{path.name} 的原内容已备份至 {backup.name}。")

    def _save_words(self, path: Path, words: Set[WordEntry]):
        """在同目录写临时文件，再原子替换；失败直接交给界面报告。"""
        self.storage_directory.mkdir(parents=True, exist_ok=True)
        self._preserve_unreadable_file(path)
        data = [asdict(word) for word in sorted(words, key=self._sort_key)]
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.storage_directory,
                prefix=f".{path.name}.", suffix=".tmp", delete=False,
            ) as stream:
                temporary_path = Path(stream.name)
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, path)
            self._unreadable_paths.discard(path)
        except OSError as exc:
            raise OSError(f"无法保存 {path.name}：{exc}") from exc
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _save_wrong_words_to_disk(self):
        """兼容旧版调用；新操作在修改内存状态之前写入候选集合。"""
        self._save_words(self.wrong_words_path, self.wrong_words)

    def _commit_wrong_words(self, words: Set[WordEntry]):
        if words != self.wrong_words:
            self._save_words(self.wrong_words_path, words)
            self.wrong_words = words

    def _reset_session(self, deck: List[WordEntry], review: bool):
        self.current_deck = deck
        self.current_index = 0
        self.results = {}
        self.review_mode = review

    @staticmethod
    def _has_valid_example(word: WordEntry) -> bool:
        return any(
            match.group(1).strip()
            for match in re.finditer(r"\[\[([^\[\]\r\n]+)\]\]", word.examples)
        )

    def start_game(self, book: str, units: List[str], filter_mode: str,
                   order_mode: str, question_mode: str,
                   show_first_letter: bool, retry_on_wrong: bool):
        """筛选并固定本轮顺序；后续回退、跳过和斩词都不改动牌组。"""
        self.all_words = list(dict.fromkeys(
            word for word in self.loader.load_word_list(book, units) if self._word_key(word)
        ))
        mastered_keys = self._get_mastered_keys()
        deck = []
        for word in self.all_words:
            if self._word_key(word) in mastered_keys:
                continue
            english = word.english.split(",", 1)[0].strip()
            is_phrase = any(character.isspace() for character in english)
            if filter_mode == "words_only" and is_phrase:
                continue
            if filter_mode == "phrases_only" and not is_phrase:
                continue
            if question_mode == "example" and not self._has_valid_example(word):
                continue
            deck.append(word)
        if order_mode == "random":
            random.shuffle(deck)
        self.question_mode = question_mode
        self.show_first_letter = show_first_letter
        self.retry_on_wrong = retry_on_wrong
        self._reset_session(deck, review=False)

    def start_review_mode(self) -> bool:
        """保留未完成错题；复习答对一题后才移除对应记录。"""
        mastered_keys = self._get_mastered_keys()
        deck = sorted(
            (word for word in self.wrong_words if self._word_key(word) not in mastered_keys),
            key=self._sort_key,
        )
        if not deck:
            return False
        random.shuffle(deck)
        self.question_mode = "word"
        self.show_first_letter = True
        self._reset_session(deck, review=True)
        return True

    def get_next_question(self) -> Optional[WordEntry]:
        # 斩词后的本轮同词不同释义也不再出现；保留原牌组和索引，方便撤销。
        mastered_keys = self._get_mastered_keys()
        while (0 <= self.current_index < len(self.current_deck)
               and self._word_key(self.current_deck[self.current_index]) in mastered_keys):
            self.current_index += 1
        if 0 <= self.current_index < len(self.current_deck):
            return self.current_deck[self.current_index]
        return None

    def previous_question(self) -> Optional[WordEntry]:
        """回到上一题；首题不越界，完成后仍可回到最后一题。"""
        if not self.current_deck:
            return None
        mastered_keys = self._get_mastered_keys()
        candidate_index = min(self.current_index, len(self.current_deck)) - 1
        while candidate_index >= 0:
            if self._word_key(self.current_deck[candidate_index]) not in mastered_keys:
                self.current_index = candidate_index
                break
            candidate_index -= 1
        return self.get_next_question()

    def check_answer(self, user_input: str) -> bool:
        word = self.get_next_question()
        if word is None:
            return False
        correct = self.normalize_answer(user_input) == self._word_key(word)
        if not correct:
            self._commit_wrong_words(self.wrong_words | {word})
        elif self.review_mode:
            self._commit_wrong_words(self.wrong_words - {word})
        # 重答替换该题的最终结果；普通测验答错后重试答对仍保留错题记录。
        self.results[self.current_index] = "correct" if correct else "wrong"
        if correct or not self.retry_on_wrong:
            self.current_index += 1
        return correct

    def skip_current_word(self) -> Optional[WordEntry]:
        """兼容旧版的计入错题跳过操作。"""
        word = self.get_next_question()
        if word is None:
            return None
        self._commit_wrong_words(self.wrong_words | {word})
        self.results[self.current_index] = "skipped"
        self.current_index += 1
        return word

    def skip_without_penalty(self) -> Optional[WordEntry]:
        """跳到下一题，保留原有错题记录。"""
        word = self.get_next_question()
        if word is None:
            return None
        self.results[self.current_index] = "skipped"
        self.current_index += 1
        return word

    def is_mastered(self, word: WordEntry) -> bool:
        return self._word_key(word) in self._get_mastered_keys()

    def _get_mastered_keys(self) -> Set[str]:
        return {self._word_key(item) for item in self.mastered_words}

    def mark_current_mastered(self) -> Optional[WordEntry]:
        """斩词：先保存熟词，再记录本题结果并进入下一题。"""
        word = self.get_next_question()
        if word is None:
            return None
        if not self.is_mastered(word):
            words = self.mastered_words | {word}
            self._save_words(self.mastered_words_path, words)
            self.mastered_words = words
        self.results[self.current_index] = "mastered"
        self.current_index += 1
        return word

    def restore_mastered_word(self, word: WordEntry) -> bool:
        """按英文 key 恢复熟词；下一轮会重新参与测试和原有错题复习。"""
        key = self._word_key(word)
        words = {item for item in self.mastered_words if self._word_key(item) != key}
        if words == self.mastered_words:
            return False
        self._save_words(self.mastered_words_path, words)
        self.mastered_words = words
        return True

    def clear_wrong_words_cache(self):
        # 即使内存中为空，也显式保存：可清空经确认需要重置的坏记录。
        self._save_words(self.wrong_words_path, set())
        self.wrong_words = set()

    def get_progress(self) -> tuple[int, int]:
        return self.current_index, len(self.current_deck)

    def get_wrong_word_count(self) -> int:
        mastered_keys = self._get_mastered_keys()
        return sum(self._word_key(word) not in mastered_keys for word in self.wrong_words)

    def get_mastered_word_count(self) -> int:
        return len(self._get_mastered_keys())

    def get_session_stats(self) -> dict:
        stats = {status: sum(result == status for result in self.results.values())
                 for status in ("correct", "wrong", "skipped", "mastered")}
        stats["answered"] = stats["correct"] + stats["wrong"]
        stats["total"] = len(self.current_deck)
        return stats

"""清爽的桌面学习主题：调色板、Qt 样式及可通过键盘操作的控件。"""
from __future__ import annotations

import os
import tempfile

from PyQt6.QtCore import Qt, QSize, pyqtSignal, QRectF
from PyQt6.QtGui import QColor, QPainter, QPainterPath, QPen, QPixmap
from PyQt6.QtWidgets import (
    QCheckBox, QFrame, QGraphicsDropShadowEffect, QHBoxLayout, QPushButton,
    QSizePolicy, QWidget,
)

# 所有调色板值均为有效的 QColor 十六进制颜色，可同时用于 QSS 和自绘。
C = {
    "primary": "#5856E8",
    "primary_hover": "#6A68EF",
    "primary_active": "#4442C8",
    "primary_bg": "#F0EFFF",
    "primary_border": "#D8D6FD",
    "success": "#16896A",
    "success_bg": "#EAF8F2",
    "success_border": "#BDE5D6",
    "error": "#D24B60",
    "error_bg": "#FFF0F2",
    "error_border": "#F2C6CD",
    "warning": "#BD8521",
    "warning_bg": "#FFF8E8",
    "warning_border": "#EFDCA8",
    "text": "#252942",
    "text_secondary": "#727991",
    "text_disabled": "#A1A8BA",
    "border": "#DCE0EB",
    "split": "#E9ECF4",
    "page_bg": "#F3F5FA",
    "surface": "#FFFFFF",
    "surface_alt": "#F8F9FD",
    "fill": "#EEF0F6",
    "switch_off": "#B8BFCE",
}

FONT_STACK = '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI Symbol", "PingFang SC", sans-serif'


def generate_assets() -> dict:
    """用 QPainter 生成 QSS 使用的复选框对勾与下拉箭头。"""
    out_dir = os.path.join(tempfile.gettempdir(), "dictation-theme")
    os.makedirs(out_dir, exist_ok=True)
    paths = {}

    pm = QPixmap(16, 16)
    pm.fill(QColor(0, 0, 0, 0))
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    pen = QPen(QColor("#FFFFFF"))
    pen.setWidthF(2.0)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    p.setPen(pen)
    p.drawPolyline([_pt(4.0, 8.4), _pt(7.0, 11.4), _pt(12.2, 4.8)])
    p.end()
    path = os.path.join(out_dir, "check.png")
    pm.save(path)
    paths["check"] = path.replace("\\", "/")

    pm = QPixmap(12, 12)
    pm.fill(QColor(0, 0, 0, 0))
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    pen = QPen(QColor(C["text_secondary"]))
    pen.setWidthF(1.6)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    p.setPen(pen)
    p.drawPolyline([_pt(2.5, 4.6), _pt(6.0, 8.1), _pt(9.5, 4.6)])
    p.end()
    path = os.path.join(out_dir, "arrow.png")
    pm.save(path)
    paths["arrow"] = path.replace("\\", "/")
    return paths


def _pt(x: float, y: float):
    from PyQt6.QtCore import QPointF
    return QPointF(x, y)


def stylesheet(assets: dict) -> str:
    """仅使用 Qt 支持的样式属性；尺寸由布局管理器自适应。"""
    check = assets.get("check", "")
    arrow = assets.get("arrow", "")
    return f"""
QWidget {{
    font-family: {FONT_STACK};
    font-size: 14px;
    color: {C['text']};
}}
QWidget#Root, QMainWindow {{ background: {C['page_bg']}; }}
QToolTip {{
    background: {C['text']}; color: #FFFFFF;
    border: 1px solid {C['text']}; border-radius: 6px;
    padding: 7px 10px;
}}

/* 页头与标题层级 */
QFrame#Header {{
    background: {C['surface']};
    border: none; border-bottom: 1px solid {C['split']};
}}
QLabel#HeaderMark {{
    background: {C['primary']}; color: #FFFFFF;
    border-radius: 15px; font-size: 23px; font-weight: 700;
}}
QLabel#HeaderTitle {{ font-size: 21px; font-weight: 700; color: {C['text']}; }}
QLabel#HeaderSub {{ font-size: 12px; color: {C['text_secondary']}; }}
QPushButton#HeaderBtn {{
    background: transparent; border: 1px solid transparent;
    border-radius: 10px; padding: 0 12px; min-height: 34px;
    color: {C['text_secondary']}; font-size: 13px;
}}
QPushButton#HeaderBtn:hover {{ background: {C['fill']}; color: {C['primary']}; }}
QPushButton#HeaderBtn:pressed {{ background: {C['primary_bg']}; }}
QPushButton#HeaderBtn:focus {{ border-color: {C['primary_border']}; color: {C['primary']}; }}
QPushButton#HeaderBtn:disabled {{ color: {C['text_disabled']}; }}

QLabel#Eyebrow {{ color: {C['primary']}; font-size: 12px; font-weight: 600; }}
QLabel#HeroTitle {{ color: {C['text']}; font-size: 29px; font-weight: 700; }}
QLabel#HeroDescription {{ color: {C['text_secondary']}; font-size: 13px; }}
QLabel#SectionLabel {{ color: {C['text_secondary']}; font-size: 12px; }}
QLabel#CardTitle {{ color: {C['text']}; font-size: 15px; font-weight: 600; }}

/* 白色卡片与小统计 */
QFrame#Card, QFrame#PracticeCard {{
    background: {C['surface']}; border: 1px solid {C['split']};
    border-radius: 20px;
}}
QFrame#StatCard {{
    background: {C['surface']}; border: 1px solid {C['split']};
    border-radius: 14px;
}}
QLabel#StatValue {{ color: {C['text']}; font-size: 23px; font-weight: 700; }}
QLabel#StatLabel {{ color: {C['text_secondary']}; font-size: 12px; }}
QLabel#Question {{ color: {C['text']}; font-size: 27px; font-weight: 600; }}
QLabel#SubQuestion {{ color: {C['text_secondary']}; font-size: 14px; }}
QFrame#PromptBox {{
    background: {C['surface_alt']}; border: 1px solid {C['split']};
    border-radius: 16px;
}}
QLabel#Chip {{
    background: {C['primary_bg']}; border: 1px solid {C['primary_border']};
    color: {C['primary_active']}; border-radius: 11px;
    padding: 3px 10px; font-size: 12px;
}}
QLabel#ChipGray {{
    background: {C['fill']}; border: 1px solid {C['split']};
    color: {C['text_secondary']}; border-radius: 11px;
    padding: 3px 10px; font-size: 12px;
}}
QLabel#ProgressText {{ color: {C['text_secondary']}; font-size: 12px; }}
QLabel#KeyHint {{ color: {C['text_secondary']}; font-size: 12px; }}

/* 答案输入与可辨认的验证状态 */
QLineEdit {{
    background: {C['surface']}; border: 1px solid {C['border']};
    border-radius: 10px; min-height: 40px; padding: 0 13px;
    font-size: 15px; selection-background-color: {C['primary']};
    selection-color: #FFFFFF;
}}
QLineEdit:hover {{ border-color: {C['primary_border']}; }}
QLineEdit:focus {{ border-color: {C['primary']}; background: #FEFEFF; }}
QLineEdit:disabled {{ background: {C['fill']}; color: {C['text_disabled']}; border-color: {C['split']}; }}
QLineEdit#Answer {{ min-height: 48px; padding: 0 16px; font-size: 18px; border-radius: 12px; }}
QLineEdit#Answer[answerState="correct"] {{
    border-color: {C['success']}; background: #F5FCF8;
}}
QLineEdit#Answer[answerState="wrong"] {{
    border-color: {C['error']}; background: #FFFAFB;
}}

/* 操作按钮 */
QPushButton {{
    background: {C['surface']}; border: 1px solid {C['border']};
    border-radius: 10px; min-height: 34px; padding: 0 13px;
    font-size: 13px; color: {C['text']};
}}
QPushButton:hover {{ border-color: {C['primary_border']}; background: {C['surface_alt']}; color: {C['primary']}; }}
QPushButton:pressed {{ border-color: {C['primary']}; background: {C['primary_bg']}; color: {C['primary_active']}; }}
QPushButton:focus {{ border-color: {C['primary']}; }}
QPushButton:disabled {{ background: {C['fill']}; color: {C['text_disabled']}; border-color: {C['split']}; }}
QPushButton#Primary, QPushButton#Submit {{
    background: {C['primary']}; border-color: {C['primary']}; color: #FFFFFF;
    min-height: 42px; border-radius: 11px; font-size: 14px; font-weight: 600;
    padding: 0 18px;
}}
QPushButton#Submit {{ min-height: 48px; }}
QPushButton#Primary:hover, QPushButton#Submit:hover {{
    background: {C['primary_hover']}; border-color: {C['primary_hover']}; color: #FFFFFF;
}}
QPushButton#Primary:pressed, QPushButton#Submit:pressed {{
    background: {C['primary_active']}; border-color: {C['primary_active']};
}}
QPushButton#Primary:focus, QPushButton#Submit:focus {{ border-color: {C['primary_active']}; }}
QPushButton#Primary:disabled, QPushButton#Submit:disabled {{
    background: #D8D9ED; border-color: #D8D9ED; color: #FFFFFF;
}}
QPushButton#Mastered {{
    background: {C['success_bg']}; border-color: {C['success_border']}; color: {C['success']};
    min-height: 36px; font-weight: 600;
}}
QPushButton#Mastered:hover {{ background: #DDF3E9; border-color: {C['success']}; }}
QPushButton#Mastered:pressed {{ background: #CBEADE; border-color: {C['success']}; }}
QPushButton#Mastered:focus {{ border-color: {C['success']}; }}
QPushButton#Mastered:disabled {{ background: {C['fill']}; border-color: {C['split']}; color: {C['text_disabled']}; }}
QPushButton#Navigation {{ background: {C['surface_alt']}; border-color: {C['border']}; min-height: 36px; }}
QPushButton#Navigation:hover {{ background: {C['primary_bg']}; color: {C['primary']}; border-color: {C['primary_border']}; }}
QPushButton#Navigation:pressed {{ background: #E4E2FA; border-color: {C['primary']}; color: {C['primary_active']}; }}
QPushButton#Navigation:focus {{ border-color: {C['primary']}; }}
QPushButton#Navigation:disabled {{ background: {C['fill']}; color: {C['text_disabled']}; border-color: {C['split']}; }}
QPushButton#Link {{
    background: transparent; border: 1px solid transparent;
    color: {C['primary']}; padding: 0 6px; min-height: 26px; font-size: 12px;
}}
QPushButton#Link:hover {{ background: {C['primary_bg']}; color: {C['primary_active']}; }}
QPushButton#Link:focus {{ border-color: {C['primary_border']}; }}
QPushButton#Link:disabled {{ color: {C['text_disabled']}; }}
QPushButton#Danger {{ background: {C['error_bg']}; color: {C['error']}; border-color: {C['error_border']}; }}
QPushButton#Danger:hover, QPushButton#Danger:focus {{ border-color: {C['error']}; }}
QPushButton#Danger:disabled {{ background: {C['fill']}; color: {C['text_disabled']}; border-color: {C['split']}; }}

/* 紧凑的分段选择器 */
QWidget#SegmentedControl {{ background: {C['fill']}; border: 1px solid {C['split']}; border-radius: 12px; }}
QPushButton#Segment, QPushButton#SegmentFirst, QPushButton#SegmentLast {{
    background: transparent; border: 1px solid transparent;
    border-radius: 8px; min-height: 30px; padding: 0 10px;
    font-size: 12px; color: {C['text_secondary']};
}}
QPushButton#Segment:hover {{ background: #E4E6F1; color: {C['text']}; }}
QPushButton#Segment:checked {{
    background: {C['surface']}; border-color: {C['primary_border']};
    color: {C['primary_active']}; font-weight: 600;
}}
QPushButton#Segment:focus {{ border-color: {C['primary']}; }}
QPushButton#Segment:disabled {{ background: transparent; color: {C['text_disabled']}; border-color: transparent; }}

/* 选择控件 */
QCheckBox {{ spacing: 8px; color: {C['text']}; font-size: 13px; }}
QCheckBox::indicator {{
    width: 16px; height: 16px; border: 1px solid {C['border']};
    border-radius: 5px; background: {C['surface']};
}}
QCheckBox::indicator:hover, QCheckBox::indicator:focus {{ border-color: {C['primary']}; }}
QCheckBox::indicator:checked {{ background: {C['primary']}; border-color: {C['primary']}; image: url("{check}"); }}
QCheckBox:focus {{ color: {C['primary_active']}; }}
QCheckBox:disabled {{ color: {C['text_disabled']}; }}
QCheckBox::indicator:disabled {{ background: {C['fill']}; border-color: {C['border']}; }}
QCheckBox::indicator:checked:disabled {{ background: #BABBE0; border-color: #BABBE0; }}
QRadioButton {{ spacing: 8px; color: {C['text']}; font-size: 13px; }}
QRadioButton::indicator {{
    width: 16px; height: 16px; border-radius: 8px;
    border: 1px solid {C['border']}; background: {C['surface']};
}}
QRadioButton::indicator:checked {{ border: 5px solid {C['primary']}; background: {C['surface']}; }}
QRadioButton:focus {{ color: {C['primary_active']}; }}
QRadioButton:disabled {{ color: {C['text_disabled']}; }}

QComboBox {{
    background: {C['surface']}; border: 1px solid {C['border']};
    border-radius: 10px; min-height: 38px; padding: 0 30px 0 12px; font-size: 13px;
}}
QComboBox:hover {{ border-color: {C['primary_border']}; }}
QComboBox:focus {{ border-color: {C['primary']}; }}
QComboBox:disabled {{ color: {C['text_disabled']}; background: {C['fill']}; border-color: {C['split']}; }}
QComboBox::drop-down {{ border: none; width: 28px; }}
QComboBox::down-arrow {{ image: url("{arrow}"); width: 12px; height: 12px; }}
QComboBox QAbstractItemView {{
    background: {C['surface']}; border: 1px solid {C['border']};
    border-radius: 8px; padding: 4px;
    selection-background-color: {C['primary_bg']}; selection-color: {C['primary_active']};
}}
QComboBox QAbstractItemView::item {{ min-height: 30px; padding: 0 9px; border-radius: 5px; }}

/* 反馈与进度 */
QFrame#Alert {{ border-radius: 12px; }}
QFrame#AlertSuccess {{ background: {C['success_bg']}; border: 1px solid {C['success_border']}; border-radius: 12px; }}
QFrame#AlertError {{ background: {C['error_bg']}; border: 1px solid {C['error_border']}; border-radius: 12px; }}
QFrame#AlertInfo {{ background: {C['primary_bg']}; border: 1px solid {C['primary_border']}; border-radius: 12px; }}
QLabel#AlertText {{ color: {C['text_secondary']}; font-size: 13px; }}
QLabel#AlertTextSuccess {{ color: {C['success']}; font-size: 13px; font-weight: 600; }}
QLabel#AlertTextError {{ color: {C['error']}; font-size: 13px; font-weight: 600; }}
QWidget#Completion {{ background: {C['primary_bg']}; border: 1px solid {C['primary_border']}; border-radius: 14px; }}
QProgressBar#AntProgress {{
    border: none; background: {C['fill']}; border-radius: 4px;
    min-height: 8px; max-height: 8px; text-align: center; color: transparent;
}}
QProgressBar#AntProgress::chunk {{ background: {C['primary']}; border-radius: 4px; }}

/* 记录及设置 */
QTextEdit, QPlainTextEdit {{
    background: {C['surface_alt']}; border: 1px solid {C['split']};
    border-radius: 10px; padding: 10px 12px; font-size: 13px; color: #4D546D;
    selection-background-color: {C['primary']}; selection-color: #FFFFFF;
}}
QTextEdit:focus, QPlainTextEdit:focus {{ border-color: {C['primary_border']}; }}
QFrame#Drawer {{ background: {C['surface']}; border: 1px solid {C['split']}; border-radius: 20px; }}
QLabel#DrawerTitle {{ color: {C['text']}; font-size: 18px; font-weight: 700; }}
QLabel#DrawerGroup {{ color: #606980; font-size: 12px; font-weight: 600; }}
QWidget#SettingsNote {{ background: {C['surface_alt']}; border: 1px solid {C['split']}; border-radius: 10px; }}
QLabel#SettingsNote {{ color: {C['text_secondary']}; font-size: 12px; padding: 10px 12px; }}
QFrame#HLine {{ background: {C['split']}; max-height: 1px; min-height: 1px; border: none; }}

/* 滚动容器 */
QScrollArea {{ border: none; background: transparent; }}
QScrollArea > QWidget > QWidget {{ background: transparent; }}
QScrollArea#UnitList {{ background: {C['surface_alt']}; border: 1px solid {C['split']}; border-radius: 10px; }}
QWidget#UnitListInner {{ background: transparent; }}
QScrollBar:vertical {{ background: transparent; width: 8px; margin: 2px 0; }}
QScrollBar::handle:vertical {{ background: #D0D5E2; border-radius: 4px; min-height: 28px; }}
QScrollBar::handle:vertical:hover {{ background: #AEB5C9; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{ background: transparent; }}
QScrollBar:horizontal {{ background: transparent; height: 8px; }}
QScrollBar::handle:horizontal {{ background: #D0D5E2; border-radius: 4px; min-width: 28px; }}
QScrollBar::handle:horizontal:hover {{ background: #AEB5C9; }}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{ width: 0; }}
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {{ background: transparent; }}

QLabel#Footer {{ color: {C['text_secondary']}; font-size: 11px; }}
QDialog, QMessageBox {{ background: {C['surface']}; }}
QMessageBox QLabel {{ color: {C['text']}; font-size: 14px; }}
"""


class Switch(QCheckBox):
    """可点击整个轨道的开关，保留 Space 操作与清晰的焦点、禁用状态。"""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedSize(48, 28)
        self.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

    def sizeHint(self) -> QSize:  # noqa: N802
        return QSize(48, 28)

    def hitButton(self, pos) -> bool:  # noqa: N802
        return self.rect().contains(pos)

    def focusInEvent(self, event):  # noqa: N802
        super().focusInEvent(event)
        self.update()

    def focusOutEvent(self, event):  # noqa: N802
        super().focusOutEvent(event)
        self.update()

    def enterEvent(self, event):  # noqa: N802
        super().enterEvent(event)
        self.update()

    def leaveEvent(self, event):  # noqa: N802
        super().leaveEvent(event)
        self.update()

    def paintEvent(self, event):  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        on = self.isChecked()
        enabled = self.isEnabled()
        if not enabled:
            track = QColor("#C9C8F0" if on else "#DEE2ED")
        elif self.isDown():
            track = QColor(C["primary_active"] if on else "#939CB4")
        elif self.underMouse():
            track = QColor(C["primary_hover"] if on else "#A8B0C3")
        else:
            track = QColor(C["primary"] if on else C["switch_off"])

        if self.hasFocus() and enabled:
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.setPen(QPen(QColor(C["primary_hover"]), 1.6))
            p.drawRoundedRect(QRectF(0.8, 1.8, self.width() - 1.6, self.height() - 3.6), 13, 13)

        rect = QRectF(3, 4, self.width() - 6, self.height() - 8)
        path = QPainterPath()
        path.addRoundedRect(rect, rect.height() / 2, rect.height() / 2)
        p.fillPath(path, track)
        knob_d = rect.height() - 4
        x = rect.right() - knob_d - 2 if on else rect.left() + 2
        p.setBrush(QColor("#FFFFFF" if enabled else "#F7F8FC"))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(QRectF(x, rect.top() + 2, knob_d, knob_d))
        p.end()


class SegmentedControl(QWidget):
    """由普通按钮组成的分段选择器，使用现有 changed / current_id API。"""

    changed = pyqtSignal(int)

    def __init__(self, options: list[str], parent: QWidget | None = None, current: int = 0):
        super().__init__(parent)
        self.setObjectName("SegmentedControl")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(4, 4, 4, 4)
        lay.setSpacing(4)
        self._buttons: list[QPushButton] = []
        for i, text in enumerate(options):
            button = QPushButton(text)
            button.setObjectName("Segment")
            button.setCheckable(True)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            button.clicked.connect(lambda _=False, idx=i: self.set_current(idx, emit=True))
            lay.addWidget(button, 1)
            self._buttons.append(button)
        self.set_current(current)

    def current_id(self) -> int:
        for i, button in enumerate(self._buttons):
            if button.isChecked():
                return i
        return 0

    def set_current(self, idx: int, emit: bool = False):
        if not 0 <= idx < len(self._buttons):
            return
        for i, button in enumerate(self._buttons):
            button.setChecked(i == idx)
        if emit:
            self.changed.emit(idx)


def add_shadow(widget: QWidget, blur: int = 18, dy: int = 3, alpha: int = 26):
    """按需添加轻微投影；默认卡片通过浅边框区分层级。"""
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(blur)
    effect.setOffset(0, dy)
    effect.setColor(QColor(0, 0, 0, alpha))
    widget.setGraphicsEffect(effect)


def card(parent: QWidget | None = None) -> QFrame:
    frame = QFrame(parent)
    frame.setObjectName("Card")
    return frame


def hline(parent: QWidget | None = None) -> QFrame:
    frame = QFrame(parent)
    frame.setObjectName("HLine")
    frame.setFrameShape(QFrame.Shape.NoFrame)
    return frame

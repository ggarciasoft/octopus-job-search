"""HTML to text, with nothing active surviving.

``docs/spec/05_DISCOVERY_CONNECTORS.md``: "Sanitize HTML to text; no scripts,
active markup, embedded instructions, or execution." The parser here is the
standard library's, it never evaluates anything, and the output is plain text
whose only structure is line breaks and ``- `` list markers. Attributes are
discarded wholesale, so an ``onload`` or a ``javascript:`` href cannot exist in
the output to be misread by anything downstream.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import Final

#: Content inside these elements is dropped, not rendered.
_DROP: Final[frozenset[str]] = frozenset(
    {"script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "head"}
)
#: Elements that end a line of text.
_BLOCK: Final[frozenset[str]] = frozenset(
    {
        "p",
        "div",
        "section",
        "article",
        "header",
        "footer",
        "main",
        "aside",
        "nav",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "table",
        "tr",
        "blockquote",
        "pre",
        "dl",
        "dt",
        "dd",
        "hr",
        "form",
        "fieldset",
        "address",
    }
)
_NBSP: Final = chr(0xA0)
_WHITESPACE: Final = re.compile(rf"[ \t\r\f\v{_NBSP}]+")
_BLANK_LINES: Final = re.compile(r"\n{3,}")


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._drop_depth = 0
        self._title_parts: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "title":
            # <title> lives inside <head>, which is otherwise dropped; its text
            # is collected separately and never enters the body text.
            self._in_title = True
            return
        if tag in _DROP:
            self._drop_depth += 1
            return
        if self._drop_depth:
            return
        if tag == "br":
            self._parts.append("\n")
        elif tag == "li":
            self._parts.append("\n- ")
        elif tag in _BLOCK:
            self._parts.append("\n")
        elif tag in {"td", "th"}:
            self._parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
            return
        if tag in _DROP:
            self._drop_depth = max(0, self._drop_depth - 1)
            return
        if self._drop_depth:
            return
        if tag in _BLOCK and tag != "li":
            # A list item ends at the next item's marker; emitting a break
            # here would put a blank line between bullets.
            self._parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)
            return
        if self._drop_depth:
            return
        self._parts.append(data)

    def handle_comment(self, data: str) -> None:
        # Comments are not content. An instruction hidden in one is dropped
        # here and never reaches the description.
        return

    @property
    def text(self) -> str:
        return "".join(self._parts)

    @property
    def title(self) -> str:
        return _collapse_inline(" ".join(self._title_parts))


def _collapse_inline(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


_ORPHAN_BULLET: Final = re.compile(r"^- *\n+(?=\S)", re.M)


def _tidy(raw: str) -> str:
    lines = [_collapse_inline(line) for line in raw.split("\n")]
    joined = "\n".join(lines)
    # <li><p>text</p></li> leaves the marker on its own line; rejoin it.
    joined = _ORPHAN_BULLET.sub("- ", joined)
    joined = _BLANK_LINES.sub("\n\n", joined)
    return joined.strip()


def html_to_text(markup: str) -> str:
    """Render HTML as plain text. Never raises on malformed input."""
    parser = _TextExtractor()
    parser.feed(markup)
    parser.close()
    return _tidy(parser.text)


def html_title(markup: str) -> str | None:
    """The document ``<title>``, if it has one."""
    parser = _TextExtractor()
    parser.feed(markup)
    parser.close()
    return parser.title or None


def entity_encoded_html_to_text(encoded: str) -> str:
    """Text from HTML that arrived entity-encoded, as the Greenhouse API sends
    ``content``: ``&lt;p&gt;...&lt;/p&gt;``. Decoded once, then rendered."""
    return html_to_text(html.unescape(encoded))


def plain_text(text: str) -> str:
    """Normalise pasted or ``descriptionPlain`` text the same way."""
    return _tidy(text.replace("\r\n", "\n").replace("\r", "\n"))


__all__ = ["entity_encoded_html_to_text", "html_title", "html_to_text", "plain_text"]

"""Value objects shared by the extractors."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..contracts.generated import ProfileImportWarning


@dataclass(frozen=True)
class TextBlock:
    """One addressable chunk of a document.

    ``locator`` is what lets a draft fact cite where it came from
    (``docs/spec/06_AI_PROFILE_AND_CV.md``: "Preserve source filename and
    page/paragraph references where available"). It is short, human readable
    and stable: ``"page 2"``, ``"paragraph 14"``, ``"table 1 row 3"``.
    """

    text: str
    locator: str


@dataclass(frozen=True)
class ExtractedDocument:
    """The result of reading a document, with provenance and honest warnings."""

    source_name: str
    source_format: str
    blocks: tuple[TextBlock, ...]
    page_count: int | None = None
    warnings: tuple[ProfileImportWarning, ...] = field(default_factory=tuple)

    @property
    def text(self) -> str:
        return "\n".join(block.text for block in self.blocks)

    @property
    def char_count(self) -> int:
        return len(self.text)

    def locator_for(self, needle: str) -> str | None:
        """Return the locator of the first block containing ``needle``.

        Used to attach provenance to a proposed fact. Returns ``None`` when the
        text is not in the document at all, which is itself a signal: a value
        with no locator was not read from this document.
        """
        if not needle:
            return None
        for block in self.blocks:
            if needle in block.text:
                return block.locator
        return None

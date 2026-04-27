from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from database import Base


class Paper(Base):
    __tablename__ = "papers"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=True)
    authors = Column(Text, nullable=True)       # JSON array string
    doi = Column(String, nullable=True)
    journal = Column(String, nullable=True)
    year = Column(String, nullable=True)
    abstract = Column(Text, nullable=True)
    pdf_path = Column(String, nullable=True)
    pdf_hash = Column(String, nullable=True, unique=True)
    status = Column(String, default="draft")    # draft | confirmed | error
    created_at = Column(DateTime, default=datetime.utcnow)
    relevance = Column(Integer, default=0)      # 0-5 star rating
    memo = Column(Text, nullable=True)          # user personal notes

    keywords = relationship("Keyword", back_populates="paper", cascade="all, delete-orphan")
    relations = relationship(
        "Relation",
        back_populates="paper",
        cascade="all, delete-orphan",
        foreign_keys="Relation.paper_id",
    )
    metrics = relationship("Metric", back_populates="paper", cascade="all, delete-orphan")
    summaries = relationship("Summary", back_populates="paper", cascade="all, delete-orphan")


class Keyword(Base):
    __tablename__ = "keywords"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"))
    keyword_name = Column(String)
    normalized_name = Column(String)
    category = Column(String)   # Material | Structure | Property | Method | Application | Metric
    confidence = Column(Float, default=0.5)
    display_order = Column(Integer, default=0)

    paper = relationship("Paper", back_populates="keywords")


class Relation(Base):
    __tablename__ = "relations"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"))
    source_keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=True)
    source_name = Column(String)        # stored directly for resilience
    relation_type = Column(String)
    target_keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=True)
    target_name = Column(String)
    confidence = Column(Float, default=0.5)
    evidence_text = Column(Text, nullable=True)
    source_section = Column(String, nullable=True)  # title | abstract | conclusion | body
    display_order = Column(Integer, default=0)

    paper = relationship("Paper", back_populates="relations", foreign_keys=[paper_id])
    source_keyword = relationship("Keyword", foreign_keys=[source_keyword_id])
    target_keyword = relationship("Keyword", foreign_keys=[target_keyword_id])


class Metric(Base):
    __tablename__ = "metrics"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"))
    metric_name = Column(String)
    value = Column(String)
    unit = Column(String, nullable=True)
    condition = Column(Text, nullable=True)
    linked_keyword_id = Column(Integer, ForeignKey("keywords.id"), nullable=True)
    confidence = Column(Float, default=0.5)
    display_order = Column(Integer, default=0)

    paper = relationship("Paper", back_populates="metrics")


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, index=True)
    paper_id = Column(Integer, ForeignKey("papers.id"))
    summary_text = Column(Text)
    summary_type = Column(String)   # main | relation_based | metric_based
    confidence = Column(Float, default=0.5)

    paper = relationship("Paper", back_populates="summaries")


# ── Map Canvas persistence ─────────────────────────────────────────────────────

class MapPosition(Base):
    """x/y position (and expansion state) for any node in the Map View canvas."""
    __tablename__ = "map_positions"
    node_id  = Column(String, primary_key=True)  # "p_1" | "kw_5" | "cn_3"
    pos_x    = Column(Float, default=100.0)
    pos_y    = Column(Float, default=100.0)
    expanded = Column(Integer, default=0)         # 1 = paper node is expanded


class MapCustomNode(Base):
    """User-created concept nodes (not auto-extracted from papers)."""
    __tablename__ = "map_custom_nodes"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    label       = Column(String, nullable=False, default="New Node")
    category    = Column(String, default="Custom")
    description = Column(String, default="")
    color       = Column(String, default="#94a3b8")
    pos_x       = Column(Float, default=100.0)
    pos_y       = Column(Float, default=100.0)


class MapEdge(Base):
    """User-drawn edges between any canvas nodes."""
    __tablename__ = "map_edges"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    source_id     = Column(String, nullable=False)   # "p_1" | "kw_5" | "cn_3"
    target_id     = Column(String, nullable=False)
    relation_type = Column(String, default="related_to")
    label         = Column(String, default="")

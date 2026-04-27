"""
Lacus domain dictionary: category mapping, normalization, metrics, and relation patterns.
"""

# ---------------------------------------------------------------------------
# Category mapping  (lowercase keyword → category)
# ---------------------------------------------------------------------------
CATEGORY_MAP = {
    # Materials
    "pbtio3": "Material", "lead titanate": "Material", "batio3": "Material",
    "barium titanate": "Material", "pvdf": "Material",
    "polyvinylidene fluoride": "Material", "zno": "Material", "zinc oxide": "Material",
    "aln": "Material", "aluminum nitride": "Material", "pmn-pt": "Material",
    "knn": "Material", "liNbO3": "Material", "lithium niobate": "Material",
    "pzt": "Material", "lead zirconate titanate": "Material",
    "graphene": "Material", "mxene": "Material", "bsto": "Material",
    "hafnium oxide": "Material", "hfo2": "Material",
    "ferroelectric": "Material", "piezoelectric material": "Material",
    "ceramic": "Material", "polymer": "Material", "thin film": "Material",
    "nanocomposite": "Material", "composite": "Material",

    # Structures
    "nanotube": "Structure", "nanorod": "Structure", "nanowire": "Structure",
    "nanofiber": "Structure", "nanoparticle": "Structure", "nanosheet": "Structure",
    "nanodisk": "Structure", "nanopillar": "Structure", "nanostructure": "Structure",
    "film": "Structure", "membrane": "Structure", "array": "Structure",
    "scaffold": "Structure", "matrix": "Structure", "multilayer": "Structure",
    "heterostructure": "Structure", "core-shell": "Structure",

    # Properties
    "curie temperature": "Property", "piezoelectric coefficient": "Property",
    "dielectric constant": "Property", "dielectric permittivity": "Property",
    "polarization": "Property", "remnant polarization": "Property",
    "coercive field": "Property", "electromechanical coupling": "Property",
    "mechanical quality factor": "Property", "loss tangent": "Property",
    "thermal conductivity": "Property", "electrical conductivity": "Property",
    "bandgap": "Property",
    "pyroelectric coefficient": "Property", "flexoelectric coefficient": "Property",

    # Methods
    "sol-gel": "Method", "hydrothermal": "Method", "chemical vapor deposition": "Method",
    "cvd": "Method", "pvd": "Method", "physical vapor deposition": "Method",
    "sputtering": "Method", "atomic layer deposition": "Method", "ald": "Method",
    "electrospinning": "Method", "sintering": "Method", "annealing": "Method",
    "calcination": "Method", "coprecipitation": "Method",
    "molecular beam epitaxy": "Method", "mbe": "Method",
    "pulsed laser deposition": "Method", "pld": "Method",
    "screen printing": "Method", "inkjet printing": "Method",
    "pfm": "Method", "piezoresponse force microscopy": "Method",
    "xrd": "Method", "x-ray diffraction": "Method",
    "sem": "Method", "scanning electron microscopy": "Method",
    "tem": "Method", "transmission electron microscopy": "Method",
    "raman spectroscopy": "Method", "ftir": "Method",

    # Applications
    "sensor": "Application", "actuator": "Application",
    "energy harvesting": "Application", "nanogenerator": "Application",
    "transducer": "Application", "sonar": "Application",
    "ultrasound": "Application", "wearable": "Application",
    "biomedical": "Application", "mems": "Application",
    "micro-electromechanical": "Application",
    "pressure sensor": "Application", "strain sensor": "Application",
    "force sensor": "Application", "touch sensor": "Application",
    "acoustic emission": "Application", "hydrophone": "Application",
    "implantable": "Application", "self-powered": "Application",
    "triboelectric": "Application", "pyroelectric": "Application",
    "electrocaloric": "Application",

    # Broader materials
    "bfo": "Material", "bismuth ferrite": "Material",
    "bnbt": "Material", "bnt": "Material",
    "kbt": "Material", "knbno3": "Material",
    "pmnt": "Material", "pb-free": "Material",
    "lead-free": "Material", "relaxor": "Material",
    "perovskite": "Material", "niobate": "Material",
    "titanate": "Material", "zirconate": "Material",
    "bismuth": "Material", "potassium": "Material",
    "sodium": "Material", "lithium": "Material",
    "polylactic acid": "Material", "pla": "Material",
    "pdms": "Material", "polyimide": "Material",
    "cellulose": "Material", "chitosan": "Material",
    "carbon nanotube": "Material", "cnt": "Material",
    "boron nitride": "Material", "bn": "Material",
    "molybdenum disulfide": "Material", "mos2": "Material",

    # Additional structures
    "micropillar": "Structure", "microstructure": "Structure",
    "grain": "Structure", "domain": "Structure",
    "porous": "Structure", "foam": "Structure",
    "fiber": "Structure", "ribbon": "Structure",
    "island": "Structure", "mesh": "Structure",

    # Epitaxial / thin film structures
    "epitaxial film": "Structure", "epitaxial layer": "Structure",
    "epitaxial": "Structure", "substrate": "Structure",
    "buffer layer": "Structure", "bottom electrode": "Structure",
    "top electrode": "Structure", "electrode": "Structure",
    "cantilever": "Structure", "resonator": "Structure",
    "diaphragm": "Structure", "beam": "Structure",
    "rhombohedral phase": "Structure", "tetragonal phase": "Structure",
    "monoclinic phase": "Structure",

    # BiFeO3 / multiferroic materials
    "bifeo3": "Material", "mn-doped bismuth ferrite": "Material",
    "mn-bfo": "Material", "multiferroic": "Material",
    "la-doped bfo": "Material", "co-doped bfo": "Material",
    "srtio3": "Material", "lanthanum aluminate": "Material",

    # Phase boundary
    "morphotropic phase boundary": "Property", "mpb": "Property",
    "phase boundary": "Property", "phase coexistence": "Property",
    "morphotropic": "Property",

    # MEMS harvester applications
    "vibration energy harvester": "Application",
    "energy harvester": "Application",
    "piezoelectric mems": "Application",
    "mems cantilever": "Application",
    "resonant energy harvester": "Application",

    # Coupling / electromechanical properties
    "electromechanical coupling factor": "Property",
    "coupling coefficient": "Property",
    "coupling factor": "Property",
    "effective piezoelectric coefficient": "Property",

    # Strain-related properties and methods
    "epitaxial strain": "Property", "misfit strain": "Property",
    "biaxial strain": "Property", "compressive strain": "Property",
    "tensile strain": "Property", "strain engineering": "Method",
    "strain-induced phase transition": "Property",

    # Additional properties
    "strain": "Property", "stress": "Property",
    "elastic modulus": "Property", "young modulus": "Property",
    "poisson ratio": "Property", "hardness": "Property",
    "fracture toughness": "Property",
    "switching": "Property", "hysteresis": "Property",
    "fatigue": "Property", "aging": "Property",
    "depolarization temperature": "Property",
    "phase transition": "Property",
    "leakage current": "Property", "breakdown voltage": "Property",

    # Additional methods
    "tape casting": "Method", "extrusion": "Method",
    "3d printing": "Method", "additive manufacturing": "Method",
    "electrodeposition": "Method", "electroplating": "Method",
    "wet etching": "Method", "dry etching": "Method",
    "lift-off": "Method", "photolithography": "Method",
    "nanoindentation": "Method", "afm": "Method",
    "atomic force microscopy": "Method",
    "impedance spectroscopy": "Method", "dielectric spectroscopy": "Method",
    "p-e loop": "Method", "hysteresis loop": "Method",
    "finite element": "Method", "fea": "Method",
    "dft": "Method", "density functional theory": "Method",
    "molecular dynamics": "Method", "md simulation": "Method",

    # Metrics
    "d33": "Metric", "d31": "Metric", "d15": "Metric",
    "g33": "Metric", "g31": "Metric", "k33": "Metric", "k31": "Metric",
    "kt": "Metric", "kp": "Metric", "tc": "Metric",
    "sensitivity": "Metric", "responsivity": "Metric",
    "output voltage": "Metric", "current density": "Metric",
    "power density": "Metric", "power output": "Metric",
    "energy density": "Metric",
}

# ---------------------------------------------------------------------------
# Normalization aliases  (alias → canonical name)
# ---------------------------------------------------------------------------
NORMALIZATION_MAP = {
    # PbTiO3 aliases
    "pto": "PbTiO3", "lead titanate": "PbTiO3", "pt": "PbTiO3",
    # BaTiO3
    "bto": "BaTiO3", "barium titanate": "BaTiO3",
    # PZT
    "lead zirconate titanate": "PZT",
    # PVDF
    "polyvinylidene fluoride": "PVDF", "polyvinylidene difluoride": "PVDF",
    # Tc
    "tc": "Curie temperature", "curie temp": "Curie temperature",
    "transition temperature": "Curie temperature",
    # Structures
    "nanotubes": "nanotube", "nanorods": "nanorod", "nanowires": "nanowire",
    "nanofibers": "nanofiber", "nanoparticles": "nanoparticle",
    "nanosheets": "nanosheet", "thin films": "thin film",
    # Methods
    "x-ray diffraction": "XRD", "scanning electron microscopy": "SEM",
    "transmission electron microscopy": "TEM",
    "piezoresponse force microscopy": "PFM",
    "atomic layer deposition": "ALD",
    "chemical vapor deposition": "CVD",
    "pulsed laser deposition": "PLD",
    "molecular beam epitaxy": "MBE",
    # BiFeO3 / multiferroic
    "bfo": "BiFeO3", "bismuth ferrite": "BiFeO3",
    "mn-bfo": "Mn-doped BiFeO3", "mn-doped bfo": "Mn-doped BiFeO3",
    # Phase boundary
    "morphotropic phase boundary": "MPB",
    # Plurals
    "vibration energy harvesters": "vibration energy harvester",
    "energy harvesters": "energy harvester",
    "epitaxial films": "epitaxial film",
}

# ---------------------------------------------------------------------------
# Known metric names for extraction
# ---------------------------------------------------------------------------
METRIC_NAMES = [
    "d33", "d31", "d15", "d32", "d24",
    "g33", "g31", "g15",
    "k33", "k31", "kt", "kp", "k15",
    "Curie temperature", "Tc", "phase transition temperature",
    "dielectric constant", "dielectric permittivity", "relative permittivity",
    "loss tangent", "tan delta",
    "remnant polarization", "Pr", "remanent polarization",
    "coercive field", "Ec",
    "piezoelectric coefficient",
    "electromechanical coupling",
    "electromechanical coupling factor",
    "coupling coefficient",
    "effective coupling coefficient",
    "mechanical quality factor", "Qm",
    "output voltage", "open-circuit voltage", "Voc",
    "short-circuit current", "Isc",
    "power density", "power output",
    "output power", "harvested power",
    "current density",
    "energy density",
    "resonant frequency", "resonance frequency",
    "quality factor",
    "figure of merit",
    "sensitivity",
    "responsivity",
    "bandgap",
    "thermal conductivity",
    "pyroelectric coefficient",
]

# ---------------------------------------------------------------------------
# Relation type definitions
# ---------------------------------------------------------------------------
RELATION_TYPES = [
    "equivalent",
    "subtype_of",
    "has_structure",
    "has_property",
    "affects",
    "increases",
    "decreases",
    "fabricated_by",
    "measured_by",
    "used_for",
    "has_value",
    "related_to",
]

# ---------------------------------------------------------------------------
# Rule patterns: (compiled regex string, relation_type, confidence_base)
# Each tuple: (pattern, relation, confidence)
# Use {A} and {B} as placeholder tokens for source and target keywords
# ---------------------------------------------------------------------------
SENTENCE_PATTERNS = [
    # equivalent
    (r"\b{A}\s+(?:is|are|=|stands for|refers to)\s+{B}\b",       "equivalent",    0.82),
    (r"\b{B}\s+(?:is|are|=|stands for|refers to)\s+{A}\b",       "equivalent",    0.82),
    (r"\b{A}\s*\([\s]*{B}[\s]*\)",                                  "equivalent",    0.85),
    (r"\b{B}\s*\([\s]*{A}[\s]*\)",                                  "equivalent",    0.85),
    # subtype_of
    (r"\b{A}\s+is\s+a(?:n)?\s+(?:type\s+of\s+|form\s+of\s+)?{B}\b", "subtype_of", 0.80),
    (r"\b{A}\s+(?:are|is)\s+a(?:n)?\s+(?:kind|class|variant)\s+of\s+{B}\b", "subtype_of", 0.78),
    # has_structure
    (r"\b{A}\s+(?:has|have|with)\s+(?:a\s+)?{B}\s+structure\b",   "has_structure", 0.80),
    (r"\b{A}\s+(?:formed|grown|synthesized)\s+(?:into|as)\s+{B}\b","has_structure", 0.75),
    (r"\b{B}\s+(?:structure|morphology)\s+of\s+{A}\b",             "has_structure", 0.78),
    # increases
    (r"\b{A}\s+(?:enhance[sd]?|improve[sd]?|increase[sd]?|boost[sd]?|promote[sd]?)\s+(?:the\s+)?{B}\b",
     "increases", 0.80),
    (r"\b{A}\s+(?:lead[s]?\s+to|result[s]?\s+in)\s+(?:an?\s+)?(?:increase|enhancement|improvement)\s+(?:in|of)\s+(?:the\s+)?{B}\b",
     "increases", 0.75),
    # decreases
    (r"\b{A}\s+(?:decrease[sd]?|reduce[sd]?|suppress[ed]?|lower[sd]?)\s+(?:the\s+)?{B}\b",
     "decreases", 0.80),
    (r"\b{A}\s+(?:lead[s]?\s+to|result[s]?\s+in)\s+(?:a\s+)?(?:decrease|reduction)\s+(?:in|of)\s+(?:the\s+)?{B}\b",
     "decreases", 0.75),
    # affects
    (r"\b{A}\s+(?:affect[s]?|influence[s]?|impact[s]?|govern[s]?)\s+(?:the\s+)?{B}\b",
     "affects", 0.75),
    # fabricated_by
    (r"\b{A}\s+(?:was|were|is|are)\s+(?:fabricated|synthesized|prepared|grown|deposited|made)\s+(?:by|using|via|through)\s+{B}\b",
     "fabricated_by", 0.85),
    (r"\b{B}\s+(?:was|were)\s+used\s+to\s+(?:fabricate|synthesize|prepare|grow)\s+{A}\b",
     "fabricated_by", 0.80),
    # measured_by
    (r"\b{A}\s+(?:was|were|is|are)\s+(?:measured|characterized|evaluated|analyzed|observed|detected)\s+(?:by|using|via|with)\s+{B}\b",
     "measured_by", 0.85),
    (r"\b{B}\s+(?:was|were)\s+used\s+to\s+(?:measure|characterize|evaluate|analyze)\s+{A}\b",
     "measured_by", 0.80),
    # used_for
    (r"\b{A}\s+(?:was|were|is|are|can\s+be)\s+used\s+(?:for|in|as)\s+(?:a\s+)?{B}\b",
     "used_for", 0.78),
    (r"\b{A}\s+(?:application|use)\s+(?:in|for)\s+{B}\b",         "used_for",      0.72),
    (r"\b{A}\s+(?:enables?|allows?|facilitates?)\s+(?:the\s+)?{B}\b",
     "used_for", 0.72),
    # has_property (exhibits / shows / demonstrates / achieves / displays)
    (r"\b{A}\s+(?:exhibits?|shows?|demonstrates?|displays?)\s+(?:a\s+|an\s+|high\s+|low\s+|excellent\s+)?{B}\b",
     "has_property", 0.80),
    (r"\b{A}\s+(?:achieves?|attains?|reaches?)\s+(?:a\s+|an\s+)?(?:high\s+|large\s+|superior\s+)?{B}\b",
     "has_property", 0.78),
    (r"\b{A}\s+(?:possess(?:es)?|present[s]?|feature[s]?)\s+(?:a\s+|an\s+)?(?:high\s+|good\s+)?{B}\b",
     "has_property", 0.75),
    # subtype_of (composed of / consisting of / made of)
    (r"\b{A}\s+(?:composed?|consist(?:ing|s)?|made)\s+of\s+{B}\b",
     "subtype_of", 0.78),
    (r"\b{A}\s+containing\s+{B}\b",
     "subtype_of", 0.72),
    # has_structure (doped with / modified with / functionalized with)
    (r"\b{A}\s+(?:doped?|co-doped?)\s+(?:with|by)\s+{B}\b",
     "has_structure", 0.82),
    (r"\b{A}\s+(?:modified|functionalized|coated|decorated)\s+(?:with|by)\s+{B}\b",
     "has_structure", 0.78),
    (r"\b{A}\s+(?:embedded?|incorporated?|dispersed?)\s+(?:in|into)\s+{B}\b",
     "has_structure", 0.75),
    # increases / decreases (additional patterns)
    (r"\b{B}\s+(?:of|in)\s+{A}\s+(?:increased?|enhanced?|improved?)\b",
     "increases", 0.75),
    (r"\b{B}\s+(?:of|in)\s+{A}\s+(?:decreased?|reduced?|suppressed?)\b",
     "decreases", 0.75),
    # via/through: "enhanced B via A" → A increases B
    (r"\benhanced?\s+{B}\s+(?:via|through|by means of)\s+(?:the\s+)?{A}\b",
     "increases", 0.82),
    (r"\bimproved?\s+{B}\s+(?:via|through|by means of)\s+(?:the\s+)?{A}\b",
     "increases", 0.80),
    (r"\b{B}\s+(?:was|is|were|are)\s+(?:enhanced?|improved?|boosted?)\s+(?:via|through|by)\s+(?:the\s+)?{A}\b",
     "increases", 0.78),
    # X-induced / X-driven / X-triggered Y → A increases B
    (r"\b{A}[-\s]induced\s+{B}\b",  "increases", 0.80),
    (r"\b{A}[-\s]driven\s+{B}\b",   "increases", 0.78),
    (r"\b{A}[-\s]triggered\s+{B}\b","increases", 0.75),
    # A leads to / results in enhancement of B
    (r"\b{A}\s+leads?\s+to\s+(?:an?\s+)?(?:enhanced?|increased?|improved?)\s+{B}\b",
     "increases", 0.78),
]

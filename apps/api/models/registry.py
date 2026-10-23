"""
Canonical model registry — imports every model module in one place.

Why this exists: seed scripts (and any other standalone entry point that
isn't main.py) must import ALL model modules before calling
Base.metadata.create_all(), or SQLAlchemy can't resolve cross-module foreign
keys and fails with NoReferencedTableError.

This bit us for real: W35-36 added `Account.company_id -> companies.id`, and
because the Phase 1/2 seed scripts each hand-listed only the models that
existed when they were written, 6 of 7 seed scripts broke — meaning a fresh
install following DEPLOYMENT.md would fail. The test suite never caught it
because tests import models transitively via main.py.

Importing this single module instead of hand-listing models means adding a
new model in a future sprint can't silently break existing scripts again.
"""

import models.user          # noqa: F401
import models.accounting    # noqa: F401
import models.ar            # noqa: F401
import models.sales         # noqa: F401
import models.ap            # noqa: F401
import models.inventory     # noqa: F401
import models.payroll       # noqa: F401
import models.tax           # noqa: F401
import models.period        # noqa: F401
import models.report        # noqa: F401
import models.knowledge     # noqa: F401
import models.company       # noqa: F401
import models.pos           # noqa: F401
import models.leave         # noqa: F401
import models.doctemplate   # noqa: F401

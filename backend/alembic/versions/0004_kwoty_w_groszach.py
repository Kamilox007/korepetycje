"""kwoty w groszach

Revision ID: 0004
Revises: 0003

Autogenerate proponował tu drop + add, co skasowałoby wszystkie kwoty.
Ta wersja przepisuje dane: dokłada kolumnę, przelicza, dopiero potem usuwa starą.
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None

# (tabela, stara kolumna float, nowa kolumna int)
COLUMNS = [
    ("students", "default_price", "default_price_grosze"),
    ("lesson_series", "price", "price_grosze"),
    ("lessons", "price", "price_grosze"),
    ("payments", "amount", "amount_grosze"),
]


def upgrade() -> None:
    for table, old, new in COLUMNS:
        # 1. nowa kolumna, na razie nullable — istniejące wiersze jej nie mają
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column(new, sa.Integer(), nullable=True))

        # 2. przeliczenie. ROUND przed CAST jest konieczne: w SQLite
        #    CAST(80.1 * 100 AS INTEGER) daje 8009, bo CAST obcina w dół.
        op.execute(
            f"UPDATE {table} SET {new} = CAST(ROUND(COALESCE({old}, 0) * 100) AS INTEGER)"
        )

        # 3. dopiero teraz kolumna może być NOT NULL, a stara znika
        with op.batch_alter_table(table) as b:
            b.alter_column(new, existing_type=sa.Integer(), nullable=False)
            b.drop_column(old)


def downgrade() -> None:
    for table, old, new in COLUMNS:
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column(old, sa.Float(), nullable=True))
        op.execute(f"UPDATE {table} SET {old} = COALESCE({new}, 0) / 100.0")
        with op.batch_alter_table(table) as b:
            b.drop_column(new)

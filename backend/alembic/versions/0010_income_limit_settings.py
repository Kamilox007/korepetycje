"""income limit settings

Revision ID: 0010
Revises: 0009

The nierejestrowana-działalność quarterly income limit is tied to the minimum
wage and changes over time (a new value from a given date), so it is a small
dated-settings table rather than one overwritable number.
"""
from alembic import op
import sqlalchemy as sa

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'income_limit_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('effective_from', sa.Date(), nullable=False),
        sa.Column('limit_grosze', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_income_limit_settings_effective_from'),
        'income_limit_settings', ['effective_from'], unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_income_limit_settings_effective_from'), table_name='income_limit_settings')
    op.drop_table('income_limit_settings')

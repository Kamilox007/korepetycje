"""lesson color override

Revision ID: 0011
Revises: 0010

A lesson can carry its own color, overriding the assigned tutor's, so a
reschedule or "still needs a time" can be flagged at a glance in the
calendar without hunting through notes.
"""
from alembic import op
import sqlalchemy as sa

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('lessons', schema=None) as batch_op:
        batch_op.add_column(sa.Column('color', sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('lessons', schema=None) as batch_op:
        batch_op.drop_column('color')

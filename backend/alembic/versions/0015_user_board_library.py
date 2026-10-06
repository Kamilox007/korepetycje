"""per-account board library

Revision ID: 0015
Revises: 0014

Shapes a tutor adds to the whiteboard library ("dodaj do biblioteki")
follow the account rather than one browser: the same library on every
device they log in on, and covered by the database backup.
"""
from alembic import op
import sqlalchemy as sa

revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('board_library', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('board_library')

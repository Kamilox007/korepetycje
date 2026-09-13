"""calendar feed token

Revision ID: 0012
Revises: 0011

Backs the public per-tutor .ics feed URL (Google Calendar "subscribe from
URL" can't carry a session cookie, so the token itself is the credential).

Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('calendar_token', sa.String(length=64), nullable=True))
        batch_op.create_index(batch_op.f('ix_users_calendar_token'), ['calendar_token'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_calendar_token'))
        batch_op.drop_column('calendar_token')

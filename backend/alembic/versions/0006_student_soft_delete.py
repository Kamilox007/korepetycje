"""student soft delete

Revision ID: 0006
Revises: 0005

Deleting a student cascaded into their payments, so one click destroyed the
financial record with no way back. Archiving replaces that in normal use;
a real delete stays available as a separate, deliberate operation.
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('students') as batch:
        batch.add_column(sa.Column('archived_at', sa.DateTime(), nullable=True))
        batch.create_index(op.f('ix_students_archived_at'), ['archived_at'])


def downgrade() -> None:
    with op.batch_alter_table('students') as batch:
        batch.drop_index(op.f('ix_students_archived_at'))
        batch.drop_column('archived_at')

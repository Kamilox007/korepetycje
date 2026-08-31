"""blik phone for tutors

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-31 20:49:53.396723
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('blik_phone', sa.String(length=9), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('blik_phone')

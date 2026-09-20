"""board assigned tutor

Revision ID: 0014
Revises: 0013

A board created by staff on a tutor's behalf was invisible to that tutor:
visibility went by created_by_user_id alone. Same split as on lessons and
payments now - created_by_user_id says who entered it, assigned_tutor_id
says whose it is. Existing boards are assigned to their creator when the
creator teaches (tutor or admin), and left unassigned for a secretary.
"""
from alembic import op
import sqlalchemy as sa

revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('boards') as batch:
        batch.add_column(sa.Column('assigned_tutor_id', sa.Integer(), nullable=True))
        batch.create_index(op.f('ix_boards_assigned_tutor_id'), ['assigned_tutor_id'])
        batch.create_foreign_key(
            'fk_boards_assigned_tutor_id_users', 'users', ['assigned_tutor_id'], ['id']
        )

    op.get_bind().execute(sa.text("""
        UPDATE boards
        SET assigned_tutor_id = created_by_user_id
        WHERE created_by_user_id IN (SELECT id FROM users WHERE role IN ('tutor', 'admin'))
    """))


def downgrade() -> None:
    with op.batch_alter_table('boards') as batch:
        batch.drop_constraint('fk_boards_assigned_tutor_id_users', type_='foreignkey')
        batch.drop_index(op.f('ix_boards_assigned_tutor_id'))
        batch.drop_column('assigned_tutor_id')
